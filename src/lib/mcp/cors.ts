/**
 * Browser access to the MCP endpoint. Auth is a bearer header (no cookies), so
 * CORS grants no ambient authority; the allow-list still keeps arbitrary sites
 * (DNS-rebinding style) out. Allowed: this site, grok.com / x.ai and their
 * subdomains over https, and owner-listed hosts (MCP_OAUTH_REDIRECT_HOSTS).
 */
const DEFAULT_HOSTS = ["grok.com", "x.ai"];

export function originAllowed(origin: string, selfOrigin: string, extraHosts = ""): boolean {
  if (origin === selfOrigin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.origin !== origin) return false;
  const host = url.hostname.toLowerCase();
  const allowed = [...DEFAULT_HOSTS, ...extraHosts.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)];
  return allowed.some((base) => host === base || host.endsWith(`.${base}`));
}

export const MCP_CORS_BASE = {
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id, mcp-protocol-version, retry-after",
  "access-control-max-age": "600",
  vary: "origin",
};

/** For public, credential-free OAuth metadata / token / registration endpoints. */
export const PUBLIC_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, mcp-protocol-version",
  "access-control-max-age": "600",
};

export function withHeaders(response: Response, headers: Record<string, string>): Response {
  const next = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) next.headers.set(k, v);
  return next;
}
