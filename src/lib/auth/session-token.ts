/**
 * Desk session tokens (pure, WebCrypto only; shared by the Worker and node tests).
 *
 * Cookie value: v1.<issuedAt>.<expiresAt>.<nonce>.<mac>
 *   issuedAt / expiresAt  unix seconds
 *   nonce                 128 random bits, hex
 *   mac                   HMAC-SHA256 over "v1.<iat>.<exp>.<nonce>", hex
 * The HMAC key is derived from ADMIN_SESSION_SECRET *and* ADMIN_TOKEN, so
 * rotating either one invalidates every session issued before. Expiry is
 * enforced on the server; the cookie Max-Age is only a hint to the browser.
 */
export const SESSION_VERSION = "v1";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours
const CLOCK_SKEW_SECONDS = 60;

const enc = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message))));
}

/** Key material bound to both secrets; changing either changes every MAC. */
export function sessionKey(adminToken: string, sessionSecret: string | undefined): string {
  return `dypol-desk|${sessionSecret ?? ""}|${adminToken}`;
}

export async function issueSession(key: string, now = Math.floor(Date.now() / 1000), ttl = SESSION_TTL_SECONDS): Promise<string> {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const body = `${SESSION_VERSION}.${now}.${now + ttl}.${nonce}`;
  return `${body}.${await hmac(key, body)}`;
}

export type SessionCheck = { ok: true; issuedAt: number; expiresAt: number } | { ok: false; reason: "malformed" | "signature" | "expired" | "future" };

export async function verifySession(key: string, value: string, now = Math.floor(Date.now() / 1000)): Promise<SessionCheck> {
  const parts = value.split(".");
  if (parts.length !== 5 || parts[0] !== SESSION_VERSION) return { ok: false, reason: "malformed" };
  const [v, iatText, expText, nonce, mac] = parts;
  if (!/^\d{1,12}$/.test(iatText) || !/^\d{1,12}$/.test(expText) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(mac)) {
    return { ok: false, reason: "malformed" };
  }
  const expected = await hmac(key, `${v}.${iatText}.${expText}.${nonce}`);
  if (!constantTimeEqual(mac, expected)) return { ok: false, reason: "signature" };
  const iat = Number(iatText);
  const exp = Number(expText);
  if (iat > now + CLOCK_SKEW_SECONDS) return { ok: false, reason: "future" };
  if (exp <= now || exp - iat > SESSION_TTL_SECONDS) return { ok: false, reason: "expired" };
  return { ok: true, issuedAt: iat, expiresAt: exp };
}

/** Compares a submitted token without leaking length or content through timing. */
export async function tokenMatches(submitted: string, expected: string, key: string): Promise<boolean> {
  const [a, b] = await Promise.all([hmac(key, `token|${submitted}`), hmac(key, `token|${expected}`)]);
  return constantTimeEqual(a, b);
}
