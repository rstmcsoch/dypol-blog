import { OAUTH_CLIENT_ID_RE } from "@/lib/automation/oauth-client";
import { workerEnv } from "@/lib/cf-env.server";
import { PUBLIC_CORS } from "./cors";
import {
  exchangeCode,
  formActionSource,
  isSignedClientId,
  issueCode,
  mcpConfigured,
  readClient,
  redirectAllowed,
  redirectMatches,
  refresh,
  registerClient,
  secretMatches,
  DEFAULT_PROFILE,
  type ProfileBinding,
} from "./auth";
import { extraClientHosts } from "./hosts.server";

/**
 * OAuth 2.1 (authorization code + S256 PKCE) for any MCP connector.
 * Public clients: RFC 7591 dynamic registration, no client secret (`none`).
 * Confidential clients: a client id + secret created in Desk → Automation and
 * bound to one profile. Gemini and other apps that reject a bearer API key
 * use that second path. Codes and tokens are HMACs keyed by MCP_TOKEN.
 * The owner approves on /oauth/authorize with the desk session, MCP_TOKEN, or
 * that profile's API key.
 */
type Env = { MCP_TOKEN?: string; MCP_LIMITER?: Limiter; SIGNIN_LIMITER?: Limiter; MCP_OAUTH_REDIRECT_HOSTS?: string };
type Limiter = { limit(o: { key: string }): Promise<{ success: boolean }> };

const SCOPE = "blog:automation";
const noStore = { "cache-control": "no-store" };
/** Grok's published callbacks (https://grok.com/oauth/mcp-client.json). */
const GROK_CALLBACKS = new Set([
  "https://grok.com/connectors-oauth-exchange-code/",
  "https://grok.com/connectors-oauth-exchange-code",
  "https://console.x.ai/connectors-oauth-exchange-code/",
  "https://console.x.ai/connectors-oauth-exchange-code",
]);
function grokCallback(uri: string): boolean {
  return GROK_CALLBACKS.has(uri);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...noStore, ...PUBLIC_CORS } });
}

function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status);
}

export function protectedResourceMetadata(request: Request): Response {
  const origin = new URL(request.url).origin;
  return json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: [SCOPE],
    resource_name: "DYPOL Blog automation (MCP)",
  });
}

export function authorizationServerMetadata(request: Request): Response {
  const origin = new URL(request.url).origin;
  return json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [SCOPE],
    // Grok (and other CIMD clients) use a URL as client_id and skip DCR when this is set.
    client_id_metadata_document_supported: true,
  });
}

async function limited(env: Env, request: Request, bucket: string): Promise<boolean> {
  if (!env.MCP_LIMITER) return true;
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  return !(await env.MCP_LIMITER.limit({ key: `${bucket}:${ip}` })).success;
}

/**
 * t79 (SEC-002): failed-token throttle for /oauth/authorize, mirroring the
 * /login budget (5 failures / 60s per IP) without punishing successful
 * approvals. Per-isolate memory (best effort) layered over the 30/60s
 * edge bucket above — together they cap online guessing at login levels.
 */
const approveFailures = new Map<string, { count: number; resetAt: number }>();
function approveThrottled(ip: string): boolean {
  const entry = approveFailures.get(ip);
  return Boolean(entry && entry.resetAt > Date.now() && entry.count >= 5);
}
function noteApproveFailure(ip: string): void {
  const now = Date.now();
  const entry = approveFailures.get(ip);
  if (!entry || entry.resetAt <= now) approveFailures.set(ip, { count: 1, resetAt: now + 60_000 });
  else entry.count += 1;
  if (approveFailures.size > 500) approveFailures.clear();
}

/** Dynamic client registration (RFC 7591), public clients only, redirect URIs allow-listed. */
export async function register(request: Request): Promise<Response> {
  const env = (await workerEnv()) as Env;
  if (!mcpConfigured(env.MCP_TOKEN)) return oauthError("temporarily_unavailable", "MCP is not enabled here.", 503);
  if (await limited(env, request, "oauth")) return oauthError("slow_down", "Too many requests.", 429);
  let body: { redirect_uris?: unknown; client_name?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return oauthError("invalid_client_metadata", "Body must be JSON.");
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string" && u.length <= 500) : [];
  const extra = await extraClientHosts(env);
  if (uris.length === 0 || uris.length > 5 || !uris.every((u) => redirectAllowed(u, extra))) {
    return oauthError(
      "invalid_redirect_uri",
      "Redirect URIs must be https on a known MCP client host (claude.ai, chatgpt.com, grok.com, ...), loopback http, or an owner-allowed host.",
    );
  }
  const clientName = typeof body.client_name === "string" ? body.client_name : "MCP client";
  const clientId = await registerClient(env.MCP_TOKEN, { name: clientName, redirectUris: uris });
  const client = await readClient(env.MCP_TOKEN, clientId);
  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: client?.name ?? "MCP client",
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: SCOPE,
    },
    201,
  );
}

function esc(value: string): string {
  const amp = String.fromCharCode(38);
  return value.replace(new RegExp(`[${amp}<>"']`, "g"), (c) => {
    if (c === amp) return `${amp}amp;`;
    if (c === "<") return `${amp}lt;`;
    if (c === ">") return `${amp}gt;`;
    if (c === '"') return `${amp}quot;`;
    return `${amp}#39;`;
  });
}

type ConfidentialRef = { profileId: string; name: string; clientId: string };
type AuthorizeParams = { clientId: string; clientName: string | null; redirectUri: string; challenge: string; state: string; scope: string; confidential: ConfidentialRef | null };

async function readParams(get: (k: string) => string | null, env: Env): Promise<AuthorizeParams | string> {
  const rawState = get("state") ?? "";
  // Gemini's relay encrypts `state` (~1400 chars). Cutting it makes
  // oauth-redirect.googleusercontent.com fail with
  // "Ciphertext HMAC does not verify". Reject over the cap; never shorten.
  if (rawState.length > 8192) return "state is too long.";
  const p = {
    responseType: get("response_type") ?? "",
    clientId: (get("client_id") ?? "").slice(0, 4000),
    redirectUri: get("redirect_uri") ?? "",
    challenge: get("code_challenge") ?? "",
    method: get("code_challenge_method") ?? "",
    state: rawState,
    scope: (get("scope") ?? SCOPE).slice(0, 200),
  };
  if (p.responseType !== "code") return "response_type must be code.";
  if (!p.clientId) return "client_id is required.";
  let clientName: string | null = null;
  let confidential: ConfidentialRef | null = null;
  if (OAUTH_CLIENT_ID_RE.test(p.clientId)) {
    // Desk-issued confidential client: the redirect must be one the admin pasted.
    // It is not limited to the public DCR host list.
    const { oauthClientById } = await import("@/content/automation.server");
    const client = await oauthClientById(p.clientId);
    if (!client) return "client_id is not registered here. Create it under Desk → Automation.";
    if (!client.redirectUris.some((r) => redirectMatches(r, p.redirectUri))) return "redirect_uri was not registered for this OAuth client. Paste this exact URL on the automation profile.";
    confidential = { profileId: client.profileId, name: client.name, clientId: client.clientId };
    clientName = client.name;
  } else {
    if (!redirectAllowed(p.redirectUri, await extraClientHosts(env))) return "redirect_uri is not allowed.";
    if (isSignedClientId(p.clientId)) {
      // Registered via /oauth/register: the redirect must be one it registered (loopback port-agnostic).
      const client = await readClient(env.MCP_TOKEN as string, p.clientId);
      if (!client) {
        // The id is an HMAC of MCP_TOKEN. Rotating that secret makes Grok's
        // saved id unverifiable, and Grok then shows "Failed to connect"
        // instead of the consent page. Its callback URL is fixed, so allow it.
        if (!grokCallback(p.redirectUri)) return "client_id is not registered here (or MCP_TOKEN was rotated). Delete the connector and add it again.";
        clientName = "Grok";
      } else {
        if (!client.redirectUris.some((r) => redirectMatches(r, p.redirectUri))) return "redirect_uri was not registered for this client.";
        clientName = client.name;
      }
    }
  }
  if (p.method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(p.challenge)) return "PKCE with S256 is required.";
  return { clientId: p.clientId, clientName, redirectUri: p.redirectUri, challenge: p.challenge, state: p.state, scope: p.scope, confidential };
}

function page(params: AuthorizeParams, message: string | null, status = 200, signedIn = false): Response {
  const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
  const target = new URL(params.redirectUri);
  const host = esc(target.host || target.protocol);
  const loopback = target.protocol === "http:";
  const who = params.clientName ? `<strong>${esc(params.clientName)}</strong> (returning to <strong>${host}</strong>)` : `<strong>${host}</strong>`;
  const bound = params.confidential
    ? `<p>This is an OAuth client you created in the desk, bound to automation profile <strong>${esc(params.confidential.name)}</strong>. Allowing it lets that AI app draft as that profile only.</p>`
    : "";
  const unverified = params.clientName && !params.confidential ? " <em>(self-registered client name \u2014 unverified)</em>" : "";
  const deskOk = signedIn && Boolean(params.confidential);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n<meta name="robots" content="noindex"><title>Connect to DYPOL Blog</title>\n<style>body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;color:#111}\ninput[type=password]{width:100%;padding:.55rem;border:2px solid #111;font:inherit}button{margin-top:1rem;padding:.6rem 1rem;border:0;background:#111;color:#fff;font:inherit;font-weight:700}\n.bad{border:2px solid #ff4d00;padding:.5rem}</style></head><body>\n<h1>Connect an MCP client</h1>\n<p>${who}${unverified} asks to draft articles on DYPOL Blog through the automation tools (scope <code>${esc(params.scope)}</code>). It cannot sign in to the desk.</p>\n${bound}\n<p class="bad">After you allow, the authorization code goes to this exact address:<br><code>${esc(params.redirectUri)}</code><br>Only continue if you started this connection yourself and recognise that address.</p>\n${loopback ? `<p class="bad">This returns to a program on this computer (${host}). Only allow it if you just started the connection from a desktop app or CLI.</p>` : ""}\n${message ? `<p class="bad" role="alert">${esc(message)}</p>` : ""}\n${deskOk ? `<p>You are signed in to the desk, so you can Allow this OAuth client without pasting a token.</p>` : ""}\n<form method="post" action="/oauth/authorize">\n${hidden("response_type", "code")}${hidden("client_id", params.clientId)}${hidden("redirect_uri", params.redirectUri)}\n${hidden("code_challenge", params.challenge)}${hidden("code_challenge_method", "S256")}${hidden("state", params.state)}${hidden("scope", params.scope)}\n<label>MCP token or profile API key${deskOk ? " (optional while signed in)" : ""}<br><input type="password" name="owner_secret" autocomplete="off"${deskOk ? "" : " required"}></label>\n<button type="submit">Allow</button></form></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-frame-options": "DENY",
      // form-action also governs where a form POST may redirect. Chrome enforces
      // that on the 302 and, when it refuses, Allow appears to do nothing.
      // The success path therefore does not 302 (see handoff).
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${formActionSource(params.redirectUri)}; frame-ancestors 'none'`,
      "referrer-policy": "no-referrer",
      ...noStore,
    },
  });
}

function handoff(target: string): Response {
  // Chrome 157 drops a cross-origin 302 that answers a form POST, so Allow
  // looks dead if we redirect. A 200 from this origin is kept; the script,
  // Refresh header, and meta refresh are a new navigation to the callback.
  // Grok only finishes the connector once that callback URL actually loads.
  const href = esc(target);
  const jsUrl = JSON.stringify(target);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n<meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${href}">\n<script>location.replace(${jsUrl})</script>\n<title>Allowed</title>\n<style>body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;color:#111}\na{display:inline-block;margin-top:1rem;padding:.6rem 1rem;background:#111;color:#fff;font-weight:700;text-decoration:none}</style></head><body>\n<h1>Allowed</h1>\n<p>The authorization code is ready. Sending you back to the app.</p>\n<p><a id="continue" href="${href}" rel="noreferrer">Continue</a></p>\n</body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      refresh: `0;url=${target}`,
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      ...noStore,
    },
  });
}

export async function authorize(request: Request): Promise<Response> {
  const env = (await workerEnv()) as Env;
  if (!mcpConfigured(env.MCP_TOKEN)) return new Response("MCP is not enabled on this deployment.", { status: 503 });
  if (request.method === "GET") {
    const url = new URL(request.url);
    const params = await readParams((k) => url.searchParams.get(k), env);
    if (typeof params === "string") return new Response(params, { status: 400, headers: noStore });
    const { deskSessionFromCookieHeader } = await import("@/lib/auth/admin.server");
    const signedIn = await deskSessionFromCookieHeader(request.headers.get("cookie"));
    return page(params, null, 200, signedIn);
  }
  // t79 (SEC-002): a browser form POST always carries Origin; reject
  // cross-origin submissions so a third-party page cannot drive this form.
  const reqOrigin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  // CSRF guard: the consent form posts from this same origin. Reject a
  // cross-site form post from a browser — signalled by a real Origin that
  // disagrees with the request URL, or by Sec-Fetch-Site: cross-site.
  // (Some browsers send "Origin: null" for same-origin form posts, and
  // non-browser clients may send neither header; both still need the token.)
  const originsMatch = (a: string, b: string): boolean => {
    if (a === b) return true;
    try {
      const ua = new URL(a), ub = new URL(b);
      const loop = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
      return loop(ua.hostname) && loop(ub.hostname) && ua.port === ub.port;
    } catch { return false; }
  };
  const crossOrigin =
    fetchSite === "cross-site" ||
    (reqOrigin !== null && reqOrigin !== "null" && !originsMatch(reqOrigin, new URL(request.url).origin));
  if (crossOrigin) {
    return new Response("Cross-origin authorization submissions are not accepted.", { status: 403, headers: noStore });
  }
  const form = await request.formData();
  const params = await readParams((k) => {
    const v = form.get(k);
    return typeof v === "string" ? v : null;
  }, env);
  if (typeof params === "string") return new Response(params, { status: 400, headers: noStore });
  if (await limited(env, request, "oauth-approve")) return page(params, "Too many attempts. Try again in a minute.", 429);
  const approveIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (approveThrottled(approveIp)) return page(params, "Too many failed attempts. Try again in a minute.", 429);
  const secret = form.get("owner_secret");
  const { deskSessionFromCookieHeader } = await import("@/lib/auth/admin.server");
  const { profileResolver, oauthClientById } = await import("@/content/automation.server");
  const signedIn = await deskSessionFromCookieHeader(request.headers.get("cookie"));
  const presented = typeof secret === "string" ? secret.slice(0, 512).trim() : "";
  // Master MCP_TOKEN → default profile. A profile API key → that profile.
  // A desk session (no token pasted) → default, or the confidential client's profile.
  let profile: ProfileBinding | null = null;
  let pastedProfile: ProfileBinding | null = null;
  let master = false;
  if (presented) {
    if (await secretMatches(presented, env.MCP_TOKEN)) master = true;
    else if (presented.startsWith("dyp_")) pastedProfile = await profileResolver.byToken(presented);
    else {
      noteApproveFailure(approveIp);
      return page(params, "That token is not right.", 401, signedIn);
    }
    if (!master && !pastedProfile) {
      noteApproveFailure(approveIp);
      return page(params, "That token is not right.", 401, signedIn);
    }
  }
  let oauthClientVersion: string | undefined;
  if (params.confidential) {
    const bound = await oauthClientById(params.clientId);
    if (!bound) return page(params, "This OAuth client was removed. Create it again in the desk.", 400, signedIn);
    if (pastedProfile && pastedProfile.id !== bound.profileId) {
      noteApproveFailure(approveIp);
      return page(params, "That API key belongs to a different automation profile.", 401, signedIn);
    }
    const ownsProfile = Boolean(pastedProfile && pastedProfile.id === bound.profileId);
    if (!master && !ownsProfile && !signedIn) {
      noteApproveFailure(approveIp);
      return page(params, "Sign in to the desk in this browser, or enter the MCP token or this profile's API key.", 401, signedIn);
    }
    profile = bound.profileId === "default" ? DEFAULT_PROFILE : { id: bound.profileId, version: pastedProfile?.version ?? "" };
    oauthClientVersion = bound.secretVersion;
  } else if (pastedProfile) {
    profile = pastedProfile;
  } else if (master) {
    profile = DEFAULT_PROFILE;
  }
  if (!profile) {
    noteApproveFailure(approveIp);
    return page(params, "That token is not right. Sign in to the desk, or paste the MCP token or a profile API key.", 401, signedIn);
  }
  approveFailures.delete(approveIp);
  const code = await issueCode(env.MCP_TOKEN, { clientId: params.clientId, redirectUri: params.redirectUri, challenge: params.challenge, profile, oauthClientVersion });
  const target = new URL(params.redirectUri);
  // State first: Google's relay verifies that ciphertext. Keep it intact
  // even if a proxy trims an over-long query string.
  if (params.state) target.searchParams.set("state", params.state);
  target.searchParams.set("code", code);
  target.searchParams.set("iss", new URL(request.url).origin);
  return handoff(target.toString());
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** client_secret_post (form/JSON body) or client_secret_basic (Authorization header). */
function readClientCredentials(request: Request, get: (k: string) => string): { clientId: string; secret: string; mismatch: boolean } {
  let headerId = "";
  let headerSecret = "";
  const basic = /^Basic\s+([A-Za-z0-9+/=_-]+)$/i.exec((request.headers.get("authorization") ?? "").trim());
  if (basic) {
    try {
      const pad = basic[1].replace(/-/g, "+").replace(/_/g, "/");
      const decoded = atob(pad + "===".slice((pad.length + 3) % 4));
      const idx = decoded.indexOf(":");
      if (idx >= 0) {
        headerId = safeDecode(decoded.slice(0, idx)).slice(0, 4000);
        headerSecret = safeDecode(decoded.slice(idx + 1)).slice(0, 512);
      }
    } catch {
      // Malformed Basic is ignored; body credentials can still authenticate a confidential client.
    }
  }
  // Signed DCR client ids (mcpcl.*) embed the redirect list. Grok's is ~280
  // characters. Cutting at 200 makes the token endpoint disagree with the
  // code, so exchange always fails and the app shows "Failed to connect".
  const bodyId = get("client_id").slice(0, 4000);
  const bodySecret = get("client_secret").slice(0, 512);
  return {
    clientId: bodyId || headerId,
    secret: bodySecret || headerSecret,
    mismatch: Boolean(headerId && bodyId && headerId !== bodyId),
  };
}

export async function token(request: Request): Promise<Response> {
  const env = (await workerEnv()) as Env;
  if (!mcpConfigured(env.MCP_TOKEN)) return oauthError("temporarily_unavailable", "MCP is not enabled here.", 503);
  if (await limited(env, request, "oauth")) return oauthError("slow_down", "Too many requests.", 429);
  const type = request.headers.get("content-type") ?? "";
  let get: (k: string) => string;
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    get = (k) => (typeof body[k] === "string" ? (body[k] as string) : "");
  } else {
    const form = await request.formData().catch(() => new FormData());
    get = (k) => {
      const v = form.get(k);
      return typeof v === "string" ? v : "";
    };
  }
  const creds = readClientCredentials(request, get);
  if (creds.mismatch) return oauthError("invalid_client", "client_id does not match the Authorization header.", 401);
  if (!creds.clientId) return oauthError("invalid_client", "client_id is required.", 401);
  if (OAUTH_CLIENT_ID_RE.test(creds.clientId)) {
    const { authenticateOauthClient } = await import("@/content/automation.server");
    const client = await authenticateOauthClient(creds.clientId, creds.secret);
    if (!client) return oauthError("invalid_client", "Unknown client or wrong client secret.", 401);
  }
  const grant = get("grant_type");
  if (grant === "authorization_code") {
    const { claimOAuthNonce } = await import("./consumed.server");
    const pair = await exchangeCode(env.MCP_TOKEN, {
      code: get("code"),
      clientId: creds.clientId,
      redirectUri: get("redirect_uri"),
      verifier: get("code_verifier"),
    }, undefined, claimOAuthNonce);
    return pair ? json(pair) : oauthError("invalid_grant", "The code is invalid, expired, already used, or does not match.");
  }
  if (grant === "refresh_token") {
    const { profileResolver } = await import("@/content/automation.server");
    const { claimOAuthNonce } = await import("./consumed.server");
    const pair = await refresh(env.MCP_TOKEN, { refreshToken: get("refresh_token"), clientId: creds.clientId }, undefined, profileResolver, claimOAuthNonce);
    return pair ? json(pair) : oauthError("invalid_grant", "The refresh token is invalid or expired.");
  }
  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
}

/** CORS preflight for the public OAuth endpoints. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: PUBLIC_CORS });
}
