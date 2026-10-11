import { workerEnv } from "@/lib/cf-env.server";
import { PUBLIC_CORS } from "./cors";
import { exchangeCode, issueCode, mcpConfigured, redirectAllowed, refresh, secretMatches } from "./auth";

/**
 * OAuth 2.1 (authorization code + S256 PKCE, public clients) for grok.com custom
 * connectors. Stateless: codes and tokens are HMACs keyed by MCP_TOKEN. The owner
 * approves a connection by entering MCP_TOKEN on /oauth/authorize.
 */
type Env = { MCP_TOKEN?: string; MCP_LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> }; MCP_OAUTH_REDIRECT_HOSTS?: string };

const SCOPE = "blog:automation";
const noStore = { "cache-control": "no-store" };

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
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  });
}

async function limited(env: Env, request: Request, bucket: string): Promise<boolean> {
  if (!env.MCP_LIMITER) return true;
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  return !(await env.MCP_LIMITER.limit({ key: `${bucket}:${ip}` })).success;
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
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (uris.length === 0 || uris.length > 5 || !uris.every((u) => redirectAllowed(u, env.MCP_OAUTH_REDIRECT_HOSTS))) {
    return oauthError("invalid_redirect_uri", "Redirect URIs must be https on grok.com / x.ai (or owner-allowed hosts).");
  }
  return json(
    {
      client_id: "dypol-mcp-client",
      client_name: typeof body.client_name === "string" ? body.client_name.slice(0, 100) : "MCP client",
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
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

type AuthorizeParams = { clientId: string; redirectUri: string; challenge: string; state: string; scope: string };

function readParams(get: (k: string) => string | null, extraHosts?: string): AuthorizeParams | string {
  const p = {
    responseType: get("response_type") ?? "",
    clientId: (get("client_id") ?? "").slice(0, 200),
    redirectUri: get("redirect_uri") ?? "",
    challenge: get("code_challenge") ?? "",
    method: get("code_challenge_method") ?? "",
    state: (get("state") ?? "").slice(0, 500),
    scope: (get("scope") ?? SCOPE).slice(0, 200),
  };
  if (p.responseType !== "code") return "response_type must be code.";
  if (!p.clientId) return "client_id is required.";
  if (!redirectAllowed(p.redirectUri, extraHosts)) return "redirect_uri is not allowed.";
  if (p.method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(p.challenge)) return "PKCE with S256 is required.";
  return { clientId: p.clientId, redirectUri: p.redirectUri, challenge: p.challenge, state: p.state, scope: p.scope };
}

function page(params: AuthorizeParams, message: string | null, status = 200): Response {
  const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
  const host = esc(new URL(params.redirectUri).host);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Connect to DYPOL Blog</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;color:#111}
input[type=password]{width:100%;padding:.55rem;border:2px solid #111;font:inherit}button{margin-top:1rem;padding:.6rem 1rem;border:0;background:#111;color:#fff;font:inherit;font-weight:700}
.bad{border:2px solid #ff4d00;padding:.5rem}</style></head><body>
<h1>Connect an MCP client</h1>
<p><strong>${host}</strong> asks to draft articles on DYPOL Blog through the automation tools (scope <code>${esc(params.scope)}</code>). It cannot sign in to the desk.</p>
${message ? `<p class="bad" role="alert">${esc(message)}</p>` : ""}
<form method="post" action="/oauth/authorize">
${hidden("response_type", "code")}${hidden("client_id", params.clientId)}${hidden("redirect_uri", params.redirectUri)}
${hidden("code_challenge", params.challenge)}${hidden("code_challenge_method", "S256")}${hidden("state", params.state)}${hidden("scope", params.scope)}
<label>MCP token (the MCP_TOKEN secret)<br><input type="password" name="owner_secret" autocomplete="off" required></label>
<button type="submit">Allow</button></form></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-frame-options": "DENY",
      // form-action also governs where the form's POST may redirect (Chromium enforces it on
      // the 302), so it must name the already allow-listed redirect_uri origin or Allow
      // silently does nothing.
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${new URL(params.redirectUri).origin}; frame-ancestors 'none'`,
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
    const params = readParams((k) => url.searchParams.get(k), env.MCP_OAUTH_REDIRECT_HOSTS);
    if (typeof params === "string") return new Response(params, { status: 400, headers: noStore });
    return page(params, null);
  }
  const form = await request.formData();
  const params = readParams((k) => {
    const v = form.get(k);
    return typeof v === "string" ? v : null;
  }, env.MCP_OAUTH_REDIRECT_HOSTS);
  if (typeof params === "string") return new Response(params, { status: 400, headers: noStore });
  if (await limited(env, request, "oauth-approve")) return page(params, "Too many attempts. Try again in a minute.", 429);
  const secret = form.get("owner_secret");
  if (typeof secret !== "string" || !(await secretMatches(secret.slice(0, 512), env.MCP_TOKEN))) {
    return page(params, "That token is not right.", 401);
  }
  const code = await issueCode(env.MCP_TOKEN, params);
  const target = new URL(params.redirectUri);
  target.searchParams.set("code", code);
  if (params.state) target.searchParams.set("state", params.state);
  target.searchParams.set("iss", new URL(request.url).origin);
  return new Response(null, { status: 302, headers: { location: target.toString(), ...noStore } });
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
  const grant = get("grant_type");
  if (grant === "authorization_code") {
    const pair = await exchangeCode(env.MCP_TOKEN, {
      code: get("code"),
      clientId: get("client_id"),
      redirectUri: get("redirect_uri"),
      verifier: get("code_verifier"),
    });
    return pair ? json(pair) : oauthError("invalid_grant", "The code is invalid, expired, or does not match.");
  }
  if (grant === "refresh_token") {
    const pair = await refresh(env.MCP_TOKEN, { refreshToken: get("refresh_token"), clientId: get("client_id") });
    return pair ? json(pair) : oauthError("invalid_grant", "The refresh token is invalid or expired.");
  }
  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
}

/** CORS preflight for the public OAuth endpoints. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: PUBLIC_CORS });
}
