import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { workerEnv } from "../cf-env.server";

/**
 * Desk access on Cloudflare Workers.
 *
 * The editor signs in with the shared ADMIN_TOKEN (a Worker secret). On success
 * the server sets an HttpOnly cookie holding an HMAC of a fixed label keyed by
 * ADMIN_SESSION_SECRET (falls back to ADMIN_TOKEN). Rotating either secret signs
 * everyone out. With no ADMIN_TOKEN configured the desk is locked (fail closed).
 */
export class ForbiddenError extends Error {
  readonly status = 403;
  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export type AdminIdentity = { id: string; email: string | null; mode: "dev" | "account" };

const COOKIE = "dypol_desk";
const LABEL = "dypol-desk-session-v1";
const MAX_AGE = 60 * 60 * 24 * 14;

async function secrets(): Promise<{ token: string; key: string } | null> {
  const env = await workerEnv();
  const token = (env.ADMIN_TOKEN ?? "").trim();
  if (token.length < 16) return null;
  const key = (env.ADMIN_SESSION_SECRET ?? "").trim() || token;
  return { token, key };
}

async function sign(key: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(LABEL)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function deskConfigured(): Promise<boolean> {
  return (await secrets()) !== null;
}

export async function requireAdmin(): Promise<AdminIdentity> {
  const s = await secrets();
  if (!s) throw new ForbiddenError();
  const cookie = getCookie(COOKIE) ?? "";
  if (!cookie || !sameText(cookie, await sign(s.key))) throw new UnauthorizedError();
  return { id: "editor", email: null, mode: "account" };
}

export async function signInDesk(token: string): Promise<boolean> {
  const s = await secrets();
  if (!s) return false;
  const a = await sign(`${s.key}:${token}`);
  const b = await sign(`${s.key}:${s.token}`);
  if (!sameText(a, b)) return false;
  setCookie(COOKIE, await sign(s.key), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  return true;
}

export function signOutDesk(): void {
  deleteCookie(COOKIE, { path: "/" });
}

/** Editor grants are not used with token sign-in. Kept for the settings UI. */
export async function listGrants(): Promise<string[]> {
  return [];
}
export async function addGrant(_email: string): Promise<void> {
  throw new Error("Editor grants are managed with the ADMIN_TOKEN secret on this deployment.");
}
export async function removeGrant(_email: string): Promise<void> {
  throw new Error("Editor grants are managed with the ADMIN_TOKEN secret on this deployment.");
}
