import { getCookie, getRequest, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { workerEnv } from "../cf-env.server";
import { checkSignIn, clientKey, type LimitDecision } from "./sign-in-limit.ts";
import { issueSession, SESSION_TTL_SECONDS, sessionKey, tokenMatches, verifySession } from "./session-token.ts";
import { assertSameOrigin, ReadOnlyError, writesAllowed } from "../write-guard.server";

/**
 * Desk access on Cloudflare Workers.
 *
 * The editor signs in with the shared ADMIN_TOKEN (a Worker secret). On success
 * the server sets an HttpOnly cookie carrying issued-at, expiry, a random nonce
 * and an HMAC keyed by ADMIN_SESSION_SECRET + ADMIN_TOKEN (see session-token.ts).
 * Rotating either secret signs everyone out; expiry is checked server-side.
 * Sign-in is rate limited per IP (see sign-in-limit.ts). With no ADMIN_TOKEN
 * configured the desk is locked (fail closed).
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

async function secrets(): Promise<{ token: string; key: string } | null> {
  const env = await workerEnv();
  const token = (env.ADMIN_TOKEN ?? "").trim();
  if (token.length < 16) return null;
  const sessionSecret = (env.ADMIN_SESSION_SECRET ?? "").trim() || undefined;
  return { token, key: sessionKey(token, sessionSecret) };
}

export async function deskConfigured(): Promise<boolean> {
  return (await secrets()) !== null;
}

/** t79 (SEC-005): server-side logout revocation (hashed nonces in D1). */
async function sessionRevoked(nonce: string): Promise<boolean> {
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`create table if not exists revoked_sessions (nonce_hash text primary key, expires_at integer not null)`;
    const { sha256Hex } = await import("@/lib/mcp/consumed.server");
    const hash = await sha256Hex(`desk:${nonce}`);
    const rows = await sql<{ n: number }>`select count(*)::int as n from revoked_sessions where nonce_hash = ${hash}`;
    return Number(rows[0]?.n ?? 0) > 0;
  } catch {
    return false; // revocation store unavailable: session HMAC+expiry still gate access
  }
}

export async function requireAdmin(): Promise<AdminIdentity> {
  const s = await secrets();
  if (!s) throw new ForbiddenError();
  const cookie = getCookie(COOKIE) ?? "";
  const check = cookie ? await verifySession(s.key, cookie) : null;
  if (!check?.ok) throw new UnauthorizedError();
  if (await sessionRevoked(check.nonce)) throw new UnauthorizedError();
  return { id: "editor", email: null, mode: "account" };
}

export async function requireWriter(): Promise<AdminIdentity> {
  const admin = await requireAdmin();
  assertSameOrigin();
  if (!(await writesAllowed())) throw new ReadOnlyError();
  return admin;
}

/** Counts this attempt against the per-IP limit. Call before checking the token. */
export async function signInAllowed(): Promise<LimitDecision> {
  const env = await workerEnv();
  const request = getRequest();
  const key = request ? clientKey(request.headers) : "signin:unknown";
  return checkSignIn(env.SIGNIN_LIMITER, key);
}

export async function signInDesk(token: string): Promise<boolean> {
  const s = await secrets();
  if (!s) return false;
  if (!(await tokenMatches(token, s.token, s.key))) return false;
  setCookie(COOKIE, await issueSession(s.key), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return true;
}

export async function signOutDesk(): Promise<void> {
  // Revoke the presented session server-side first (SEC-005): a copied
  // cookie stops working immediately, not at its 12-hour expiry.
  try {
    const s = await secrets();
    const cookie = getCookie(COOKIE) ?? "";
    const check = s && cookie ? await verifySession(s.key, cookie) : null;
    if (s && check?.ok) {
      const { getSql } = await import("@/lib/db");
      const sql = await getSql();
      await sql`create table if not exists revoked_sessions (nonce_hash text primary key, expires_at integer not null)`;
      const { sha256Hex } = await import("@/lib/mcp/consumed.server");
      await sql`insert or ignore into revoked_sessions (nonce_hash, expires_at) values (${await sha256Hex(`desk:${check.nonce}`)}, ${check.expiresAt})`;
      await sql`delete from revoked_sessions where expires_at < ${Math.floor(Date.now() / 1000)}`.catch(() => undefined);
    }
  } catch { /* still clear the browser cookie below */ }
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
