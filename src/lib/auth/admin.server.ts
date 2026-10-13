import { getCookie, getRequest, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { workerEnv } from "../cf-env.server";
import { checkSignIn, clientKey, type LimitDecision } from "./sign-in-limit.ts";
import { issueSession, SESSION_TTL_SECONDS, sessionKey, tokenMatches, verifySession } from "./session-token.ts";
import { assertSameOrigin, ReadOnlyError, writesAllowed } from "../write-guard.server";
import { DESK_THEME_COOKIE, parseDeskTheme, type DeskTheme } from "../admin-theme";

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

export type DeskSession = AdminIdentity & { theme: DeskTheme };

export async function requireAdmin(): Promise<AdminIdentity> {
  const s = await secrets();
  if (!s) throw new ForbiddenError();
  const cookie = getCookie(COOKIE) ?? "";
  if (!cookie || !(await verifySession(s.key, cookie)).ok) throw new UnauthorizedError();
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

/**
 * The editor's desk appearance. A cookie is the source of truth so the loader
 * can hand the shell the right palette before the first paint; nothing is read
 * from localStorage.
 */
export async function readDeskTheme(): Promise<DeskTheme> {
  return parseDeskTheme(getCookie(DESK_THEME_COOKIE)) ?? "system";
}

export async function writeDeskTheme(theme: DeskTheme): Promise<DeskTheme> {
  assertSameOrigin();
  setCookie(DESK_THEME_COOKIE, theme, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return theme;
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
