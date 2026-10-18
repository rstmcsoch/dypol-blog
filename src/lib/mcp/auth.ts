/**
 * MCP authentication (pure, WebCrypto only).
 *
 * Two ways in, both rooted in the MCP_TOKEN Worker secret (separate from the
 * desk's ADMIN_TOKEN / ADMIN_SESSION_SECRET):
 *  1. Static bearer:   Authorization: Bearer <MCP_TOKEN>
 *     (Claude Code / Cursor / Gemini CLI / Grok CLI headers, scripts)
 *  2. OAuth 2.1 + PKCE + dynamic client registration (any MCP connector:
 *     Claude, ChatGPT, Grok, Cursor, VS Code, ...): the owner approves on
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

type Kind = "mcpat" | "mcprt" | "mcpac" | "mcpcl";

async function mint(kind: Kind, mcpToken: string, ttl: number, payload: object, now: number): Promise<string> {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const body = `${kind}.v1.${now + ttl}.${nonce}.${b64url(JSON.stringify(payload))}`;
  return `${body}.${await hmac(keyFor(mcpToken), body)}`;
}

async function open<T>(kind: Kind, mcpToken: string, value: string, now: number): Promise<T | null> {
  return (await openWithNonce<T>(kind, mcpToken, value, now))?.payload ?? null;
}

async function openWithNonce<T>(kind: Kind, mcpToken: string, value: string, now: number): Promise<{ payload: T; nonce: string; exp: number } | null> {
  const parts = value.split(".");
  if (parts.length !== 6 || parts[0] !== kind || parts[1] !== "v1") return null;
  const [, , expText, nonce, payload, mac] = parts;
  if (!/^\d{1,12}$/.test(expText) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(mac)) return null;
  const expected = await hmac(keyFor(mcpToken), parts.slice(0, 5).join("."));
  if (!constantTimeEqual(mac, expected)) return null;
  if (Number(expText) <= now) return null;
  try {
    return { payload: JSON.parse(fromB64url(payload)) as T, nonce, exp: Number(expText) };
  } catch {
    return null;
  }
}

/**
 * t79 (SEC-001): single-use consumption. The HTTP layer passes a D1-backed
 * `consume(kind, nonce)` that atomically claims the nonce; returning false
 * means the code/refresh token was already used and must be rejected.
 * Pure callers (unit tests) may omit it; the token endpoint never does.
 */
export type NonceConsumer = (kind: "code" | "refresh", nonce: string) => Promise<boolean>;

const nowSec = () => Math.floor(Date.now() / 1000);

/** The profile an MCP credential acts as. "default" = the master MCP_TOKEN. */
export type ProfileBinding = { id: string; version: string };
export const DEFAULT_PROFILE: ProfileBinding = { id: "default", version: "" };

/**
 * Looks up a per-profile token (`dyp_<profile>_<secret>`) and confirms a
 * profile binding is still current (its token was not revoked or replaced).
 */
export type ProfileResolver = {
  byToken(token: string): Promise<ProfileBinding | null>;
  stillValid(binding: ProfileBinding): Promise<boolean>;
};

export type AuthResult =
  | { ok: true; via: "bearer" | "oauth" | "profile-token"; client?: string; profile: ProfileBinding }
  | { ok: false; reason: "missing" | "invalid" | "disabled" };

/** Label for OAuth clients that registered before signed client ids (e.g. Grok before PR #4). */
export const LEGACY_CLIENT_LABEL = "legacy connector";

export async function authenticate(
  authorization: string | null,
  mcpToken: string | undefined,
  now = nowSec(),
  profiles?: ProfileResolver,
): Promise<AuthResult> {
  if (!mcpConfigured(mcpToken)) return { ok: false, reason: "disabled" };
  const match = /^Bearer\s+(\S{1,2048})$/i.exec(authorization?.trim() ?? "");
  if (!match) return { ok: false, reason: "missing" };
  const presented = match[1];
  if (presented.startsWith("mcpat.")) {
    const payload = await open<{ c: string; n?: string; p?: string; v?: string }>("mcpat", mcpToken, presented, now);
    if (!payload) return { ok: false, reason: "invalid" };
    const profile = payload.p && payload.p !== "default" ? { id: payload.p, version: payload.v ?? "" } : DEFAULT_PROFILE;
    if (profile.id !== "default" && !(profiles && (await profiles.stillValid(profile)))) return { ok: false, reason: "invalid" };
    return { ok: true, via: "oauth", client: payload.n ?? (payload.c === "signed" ? undefined : LEGACY_CLIENT_LABEL), profile };
  }
  if (presented.startsWith("dyp_") && profiles) {
    const profile = await profiles.byToken(presented);
    return profile ? { ok: true, via: "profile-token", profile } : { ok: false, reason: "invalid" };
  }
  return (await secretMatches(presented, mcpToken)) ? { ok: true, via: "bearer", profile: DEFAULT_PROFILE } : { ok: false, reason: "invalid" };
}

// ---- OAuth 2.1 helpers -------------------------------------------------------

/**
 * https hosts (and their subdomains) of well-known MCP connector clients. Sources:
 *  - Claude (claude.ai/claude.com): https://claude.com/docs/connectors/building/authentication
 *    -> https://claude.ai/api/mcp/auth_callback, https://claude.com/api/mcp/auth_callback
 *  - ChatGPT connectors: https://chatgpt.com/connector_platform_oauth_redirect (+ newer chatgpt.com paths)
 *  - Grok: grok.com / x.ai connector callbacks
 *  - Cursor web/agents: https://www.cursor.com/agents/mcp/oauth/callback (https://cursor.com/docs/mcp)
 *  - VS Code: https://vscode.dev/redirect, https://insiders.vscode.dev/redirect (microsoft/vscode#278512)
 *  - Perplexity: perplexity.ai (unverified; listed so its connector can register)
 * Desktop/CLI clients (Claude Code, Cursor desktop :8787, VS Code :33418, Gemini CLI, Grok CLI)
 * use loopback http on any port (RFC 8252 sections 7.3 / 8.3).
 */
export const DEFAULT_REDIRECT_HOSTS = [
  "grok.com",
  "x.ai",
  "claude.ai",
  "claude.com",
  "chatgpt.com",
  "openai.com",
  "cursor.com",
  "vscode.dev",
  "perplexity.ai",
] as const;

/** Private-use URI schemes of native clients (RFC 8252 section 7.1), exact scheme + host. */
const CUSTOM_SCHEME_REDIRECTS = [{ protocol: "cursor:", host: "anysphere.cursor-mcp" }];

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function parseHostList(...lists: (string | readonly string[] | undefined)[]): string[] {
  const out = new Set<string>();
  for (const list of lists) {
    const items = typeof list === "string" ? list.split(",") : (list ?? []);
    for (const raw of items) {
      const host = raw.trim().toLowerCase().replace(/^\*\./, "");
      if (/^[a-z0-9.-]{1,253}$/.test(host) && host.includes(".") && !host.startsWith(".")) out.add(host);
    }
  }
  return [...out];
}

function hostMatches(host: string, allowed: readonly string[]): boolean {
  return allowed.some((base) => host === base || host.endsWith(`.${base}`));
}

/** Redirect URIs: https on a known client host or owner-listed host; loopback http (any port); known native schemes. */
export function redirectAllowed(uri: string, extraHosts: string | readonly string[] = ""): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:") return LOOPBACK.has(host);
  if (url.protocol === "https:") return hostMatches(host, [...DEFAULT_REDIRECT_HOSTS, ...parseHostList(extraHosts)]);
  return CUSTOM_SCHEME_REDIRECTS.some((s) => s.protocol === url.protocol && s.host === host);
}

/** Same URI, ignoring the port for loopback http (RFC 8252 7.3: ephemeral ports). */
export function redirectMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  try {
    const a = new URL(registered);
    const b = new URL(requested);
    if (a.protocol !== "http:" || b.protocol !== "http:" || !LOOPBACK.has(a.hostname) || a.hostname !== b.hostname) return false;
    return a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}

/** CSP form-action source for a redirect URI (custom schemes have an opaque origin). */
export function formActionSource(uri: string): string {
  const url = new URL(uri);
  return url.protocol === "http:" || url.protocol === "https:" ? url.origin : url.protocol;
}

// ---- Dynamic client registration: stateless signed client ids ---------------

export const CLIENT_TTL = 60 * 60 * 24 * 365 * 5; // 5 years; rotating MCP_TOKEN voids them all
export type RegisteredClient = { name: string; redirectUris: string[] };

export function cleanClientName(name: unknown): string {
  const text = typeof name === "string" ? name.replace(/[^\p{L}\p{N} ._()\-]/gu, "").trim().slice(0, 60) : "";
  return text || "MCP client";
}

export async function registerClient(mcpToken: string, client: RegisteredClient, now = nowSec()): Promise<string> {
  return mint("mcpcl", mcpToken, CLIENT_TTL, { n: cleanClientName(client.name), r: client.redirectUris }, now);
}

/** Registered client for a signed client_id; null for unsigned/legacy ids (e.g. "dypol-mcp-client"). */
export async function readClient(mcpToken: string, clientId: string, now = nowSec()): Promise<RegisteredClient | null> {
  if (!clientId.startsWith("mcpcl.")) return null;
  const p = await open<{ n: string; r: string[] }>("mcpcl", mcpToken, clientId, now);
  return p && Array.isArray(p.r) ? { name: cleanClientName(p.n), redirectUris: p.r.filter((u) => typeof u === "string") } : null;
}

export function isSignedClientId(clientId: string): boolean {
  return clientId.startsWith("mcpcl.");
}

export async function pkceS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(verifier));
  return b64url(new Uint8Array(digest));
}

type CodePayload = { c: string; r: string; ch: string; p?: string; v?: string };

export async function issueCode(
  mcpToken: string,
  input: { clientId: string; redirectUri: string; challenge: string; profile?: ProfileBinding },
  now = nowSec(),
) {
  const p = input.profile && input.profile.id !== "default" ? { p: input.profile.id, v: input.profile.version } : {};
  return mint("mcpac", mcpToken, CODE_TTL, { c: input.clientId, r: input.redirectUri, ch: input.challenge, ...p } satisfies CodePayload, now);
}

export type TokenResponse = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

async function tokenPair(mcpToken: string, clientId: string, now: number, profile?: { p?: string; v?: string }): Promise<TokenResponse> {
  const client = await readClient(mcpToken, clientId, now);
  const p = profile?.p ? { p: profile.p, v: profile.v ?? "" } : {};
  return {
    access_token: await mint("mcpat", mcpToken, ACCESS_TTL, client ? { c: "signed", n: client.name, ...p } : { c: clientId, ...p }, now),
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    refresh_token: await mint("mcprt", mcpToken, REFRESH_TTL, { c: clientId, ...p }, now),
    scope: "blog:automation",
  };
}

export async function exchangeCode(
  mcpToken: string,
  input: { code: string; clientId: string; redirectUri: string; verifier: string },
  now = nowSec(),
  consume?: NonceConsumer,
): Promise<TokenResponse | null> {
  const opened = await openWithNonce<CodePayload>("mcpac", mcpToken, input.code, now);
  if (!opened) return null;
  const payload = opened.payload;
  if (!constantTimeEqual(payload.c, input.clientId) || !constantTimeEqual(payload.r, input.redirectUri)) return null;
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier)) return null;
  if (!constantTimeEqual(await pkceS256(input.verifier), payload.ch)) return null;
  // Authorization codes are single-use (RFC 6749 §4.1.2): claim the nonce
  // after all other checks pass, immediately before minting the pair.
  if (consume && !(await consume("code", opened.nonce))) return null;
  return tokenPair(mcpToken, input.clientId, now, payload);
}

export async function refresh(
  mcpToken: string,
  input: { refreshToken: string; clientId: string },
  now = nowSec(),
  profiles?: ProfileResolver,
  consume?: NonceConsumer,
): Promise<TokenResponse | null> {
  const opened = await openWithNonce<{ c: string; p?: string; v?: string }>("mcprt", mcpToken, input.refreshToken, now);
  if (!opened) return null;
  const payload = opened.payload;
  if (!constantTimeEqual(payload.c, input.clientId)) return null;
  // A revoked/replaced profile token also ends its OAuth sessions.
  if (payload.p && !(profiles && (await profiles.stillValid({ id: payload.p, version: payload.v ?? "" })))) return null;
  // Refresh-token rotation (t79, SEC-001): the presented refresh token is
  // consumed; only the newly issued one works next time.
  if (consume && !(await consume("refresh", opened.nonce))) return null;
  return tokenPair(mcpToken, input.clientId, now, payload);
}
