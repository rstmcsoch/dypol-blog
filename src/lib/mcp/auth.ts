/**
 * MCP authentication (pure, WebCrypto only).
 *
 * Two ways in, both rooted in the MCP_TOKEN Worker secret (separate from the
 * desk's ADMIN_TOKEN / ADMIN_SESSION_SECRET):
 *  1. Static bearer:   Authorization: Bearer <MCP_TOKEN>
 *     (Grok CLI `grok mcp add --header`, other MCP clients, scripts)
 *  2. OAuth 2.1 + PKCE (grok.com custom connectors): the owner approves on
 *     /oauth/authorize by entering MCP_TOKEN; the site issues a short-lived
 *     signed access token. Tokens are stateless HMACs keyed by MCP_TOKEN, so
 *     rotating MCP_TOKEN revokes every OAuth grant at once.
 * All comparisons are constant time.
 */
const enc = new TextEncoder();

export const ACCESS_TTL = 60 * 60; // 1 hour
export const REFRESH_TTL = 60 * 60 * 24 * 30; // 30 days
export const CODE_TTL = 5 * 60; // 5 minutes
export const MIN_MCP_TOKEN_LENGTH = 32;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? enc.encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const bin = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
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

/** Secrets pasted into dashboards often carry a trailing newline/space; never part of the token. */
const norm = (value: string) => value.trim();
const keyFor = (mcpToken: string) => `dypol-mcp|${norm(mcpToken)}`;

export function mcpConfigured(mcpToken: string | undefined): mcpToken is string {
  return typeof mcpToken === "string" && mcpToken.trim().length >= MIN_MCP_TOKEN_LENGTH;
}

/** Compares a presented secret to MCP_TOKEN without leaking length or content. */
export async function secretMatches(presented: string, mcpToken: string): Promise<boolean> {
  const key = keyFor(mcpToken);
  const [a, b] = await Promise.all([hmac(key, `static|${norm(presented)}`), hmac(key, `static|${norm(mcpToken)}`)]);
  return constantTimeEqual(a, b);
}

type Kind = "mcpat" | "mcprt" | "mcpac";

async function mint(kind: Kind, mcpToken: string, ttl: number, payload: object, now: number): Promise<string> {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const body = `${kind}.v1.${now + ttl}.${nonce}.${b64url(JSON.stringify(payload))}`;
  return `${body}.${await hmac(keyFor(mcpToken), body)}`;
}

async function open<T>(kind: Kind, mcpToken: string, value: string, now: number): Promise<T | null> {
  const parts = value.split(".");
  if (parts.length !== 6 || parts[0] !== kind || parts[1] !== "v1") return null;
  const [, , expText, nonce, payload, mac] = parts;
  if (!/^\d{1,12}$/.test(expText) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(mac)) return null;
  const expected = await hmac(keyFor(mcpToken), parts.slice(0, 5).join("."));
  if (!constantTimeEqual(mac, expected)) return null;
  if (Number(expText) <= now) return null;
  try {
    return JSON.parse(fromB64url(payload)) as T;
  } catch {
    return null;
  }
}

const nowSec = () => Math.floor(Date.now() / 1000);

export type AuthResult = { ok: true; via: "bearer" | "oauth" } | { ok: false; reason: "missing" | "invalid" | "disabled" };

export async function authenticate(authorization: string | null, mcpToken: string | undefined, now = nowSec()): Promise<AuthResult> {
  if (!mcpConfigured(mcpToken)) return { ok: false, reason: "disabled" };
  const match = /^Bearer\s+(\S{1,2048})$/i.exec(authorization?.trim() ?? "");
  if (!match) return { ok: false, reason: "missing" };
  const presented = match[1];
  if (presented.startsWith("mcpat.")) {
    return (await open("mcpat", mcpToken, presented, now)) ? { ok: true, via: "oauth" } : { ok: false, reason: "invalid" };
  }
  return (await secretMatches(presented, mcpToken)) ? { ok: true, via: "bearer" } : { ok: false, reason: "invalid" };
}

// ---- OAuth 2.1 helpers -------------------------------------------------------

const DEFAULT_REDIRECT_HOSTS = ["grok.com", "x.ai"];

/** Redirect URIs: https on grok.com / x.ai (and subdomains) or extra owner-listed hosts; loopback http for CLIs. */
export function redirectAllowed(uri: string, extraHosts = ""): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:") return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  if (url.protocol !== "https:") return false;
  const allowed = [...DEFAULT_REDIRECT_HOSTS, ...extraHosts.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)];
  return allowed.some((base) => host === base || host.endsWith(`.${base}`));
}

export async function pkceS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(verifier));
  return b64url(new Uint8Array(digest));
}

type CodePayload = { c: string; r: string; ch: string };

export async function issueCode(mcpToken: string, input: { clientId: string; redirectUri: string; challenge: string }, now = nowSec()) {
  return mint("mcpac", mcpToken, CODE_TTL, { c: input.clientId, r: input.redirectUri, ch: input.challenge } satisfies CodePayload, now);
}

export type TokenResponse = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

async function tokenPair(mcpToken: string, clientId: string, now: number): Promise<TokenResponse> {
  return {
    access_token: await mint("mcpat", mcpToken, ACCESS_TTL, { c: clientId }, now),
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    refresh_token: await mint("mcprt", mcpToken, REFRESH_TTL, { c: clientId }, now),
    scope: "blog:automation",
  };
}

export async function exchangeCode(
  mcpToken: string,
  input: { code: string; clientId: string; redirectUri: string; verifier: string },
  now = nowSec(),
): Promise<TokenResponse | null> {
  const payload = await open<CodePayload>("mcpac", mcpToken, input.code, now);
  if (!payload) return null;
  if (!constantTimeEqual(payload.c, input.clientId) || !constantTimeEqual(payload.r, input.redirectUri)) return null;
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier)) return null;
  if (!constantTimeEqual(await pkceS256(input.verifier), payload.ch)) return null;
  return tokenPair(mcpToken, input.clientId, now);
}

export async function refresh(mcpToken: string, input: { refreshToken: string; clientId: string }, now = nowSec()): Promise<TokenResponse | null> {
  const payload = await open<{ c: string }>("mcprt", mcpToken, input.refreshToken, now);
  if (!payload || !constantTimeEqual(payload.c, input.clientId)) return null;
  return tokenPair(mcpToken, input.clientId, now);
}
