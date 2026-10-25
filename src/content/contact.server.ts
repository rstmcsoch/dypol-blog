/**
 * t115 contact form: Cloudflare Turnstile + server-side Siteverify, then the
 * message is stored in D1 (contact_messages) and listed in admin → Messages.
 *
 * Keys: TURNSTILE_SITE_KEY (var) + TURNSTILE_SECRET_KEY (secret).
 * Local dev without keys uses Cloudflare's always-pass test keys; production
 * without keys fails closed (the form shows "temporarily unavailable").
 */
import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import { workerEnv } from "@/lib/cf-env.server";

export const TEST_SITE_KEY = "1x00000000000000000000AA";
const TEST_SECRET = "1x0000000000000000000000000000000AA";
const ACTION = "contact";

function isLocalHost(host: string): boolean {
  const h = host.replace(/:\d+$/, "");
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

export async function turnstileConfig(host: string): Promise<{ siteKey: string | null; secret: string | null; test: boolean }> {
  const env = await workerEnv();
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() || null;
  const secret = env.TURNSTILE_SECRET_KEY?.trim() || null;
  if (siteKey && secret) return { siteKey, secret, test: false };
  if (isLocalHost(host)) return { siteKey: TEST_SITE_KEY, secret: TEST_SECRET, test: true };
  return { siteKey: null, secret: null, test: false };
}

export type ContactInput = { name: string; email: string; message: string; token: string; website?: string };
export type ContactResult = { ok: true } | { ok: false; status: number; error: string };

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

export function validateContact(raw: Partial<Record<keyof ContactInput, unknown>>): { input: ContactInput } | { error: string } {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const input: ContactInput = { name: str(raw.name), email: str(raw.email), message: str(raw.message), token: str(raw.token), website: str(raw.website) };
  if (!input.name || input.name.length > 120) return { error: "Please enter your name (up to 120 characters)." };
  if (!EMAIL.test(input.email) || input.email.length > 254) return { error: "Please enter a valid email address." };
  if (input.message.length < 10) return { error: "Please write a message of at least 10 characters." };
  if (input.message.length > 5000) return { error: "Your message is too long (5,000 characters max)." };
  if (!input.token || input.token.length > 2048) return { error: "Please complete the verification check." };
  return { input };
}

export async function submitContact(raw: unknown, request: Request): Promise<ContactResult> {
  const host = new URL(request.url).host;
  const cfg = await turnstileConfig(host);
  if (!cfg.siteKey || !cfg.secret) return { ok: false, status: 503, error: "The contact form is temporarily unavailable. Please try again later." };
  const parsed = validateContact((raw ?? {}) as Record<string, unknown>);
  if ("error" in parsed) return { ok: false, status: 400, error: parsed.error };
  const { input } = parsed;
  // Honeypot: bots fill the hidden "website" field; pretend success, store nothing.
  if (input.website) return { ok: true };

  let result: { success?: boolean; action?: string; hostname?: string };
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret: cfg.secret,
        response: input.token,
        remoteip: request.headers.get("cf-connecting-ip") ?? "",
        idempotency_key: randomUUID(),
      }),
    });
    if (!r.ok) throw new Error(`siteverify ${r.status}`);
    result = (await r.json()) as typeof result;
  } catch (error) {
    console.error("[contact] siteverify failed", error);
    return { ok: false, status: 503, error: "We couldn't verify the check right now. Please try again in a moment." };
  }
  const expectedHost = host.replace(/:\d+$/, "");
  // Test keys answer with a dummy hostname/action; real keys must match this site and action.
  const passes = result.success === true && (cfg.test || (result.action === ACTION && result.hostname === expectedHost));
  if (!passes) return { ok: false, status: 403, error: "Verification failed. Please complete the check again and resend." };

  const sql = await getSql();
  await sql`create table if not exists contact_messages (id text primary key, name text not null, email text not null, message text not null, created_at text not null, handled integer not null default 0)`;
  const now = new Date().toISOString();
  await sql`insert into contact_messages (id, name, email, message, created_at) values (${randomUUID()}, ${input.name}, ${input.email}, ${input.message}, ${now})`;
  return { ok: true };
}

export async function listContactMessages(limit = 200): Promise<Array<{ id: string; name: string; email: string; message: string; createdAt: string }>> {
  try {
    const sql = await getSql();
    const rows = await sql<{ id: string; name: string; email: string; message: string; created_at: string }>`select id, name, email, message, created_at from contact_messages order by created_at desc limit ${limit}`;
    return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, message: r.message, createdAt: r.created_at }));
  } catch {
    return [];
  }
}
