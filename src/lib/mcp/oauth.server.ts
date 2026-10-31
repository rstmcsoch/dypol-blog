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
