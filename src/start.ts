import { createMiddleware, createStart } from "@tanstack/react-start";

/**
 * t79 (SEC-008): baseline security headers on every HTML response.
 * Deliberately no Content-Security-Policy: the app relies on inline theme
 * bootstrapping, and a mis-tuned CSP would break rendering; frame, MIME
 * sniffing, referrer and capability headers are safe to set globally.
 * (OAuth consent and /media already set their own stricter headers —
 * `set` here only fills the gaps, it does not weaken existing values.)
 */
const securityHeaders = createMiddleware().server(async ({ request, pathname, next }) => {
  // MCP clients (Grok included) try these when the server lives at /mcp.
  // A blog 404 HTML here aborts discovery before the consent page opens.
  if (
    request.method !== "POST" &&
    (pathname === "/.well-known/oauth-authorization-server/mcp" ||
      pathname === "/.well-known/openid-configuration" ||
      pathname === "/.well-known/openid-configuration/mcp")
  ) {
    const oauth = await import("@/lib/mcp/oauth.server");
    if (request.method === "OPTIONS") return oauth.preflight();
    return oauth.authorizationServerMetadata(request);
  }
  const result = await next();
  const headers = result.response.headers;
  const type = headers.get("content-type") ?? "";
  if (type.includes("text/html")) {
    // Admin, preview and auth pages must never be cached. Public pages get a
    // short shared cache so they stay fast while settings changes still show
    // within about a minute.
    const path = new URL(request.url).pathname;
    const privatePath = /^\/(admin|preview|oauth|api|auth)(\/|$)/.test(path);
    if (privatePath) headers.set("cache-control", "no-store");
    else if (!headers.has("cache-control")) headers.set("cache-control", "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
    if (!headers.has("strict-transport-security")) headers.set("strict-transport-security", "max-age=31536000");
    if (!headers.has("x-content-type-options")) headers.set("x-content-type-options", "nosniff");
    if (!headers.has("x-frame-options")) headers.set("x-frame-options", "SAMEORIGIN");
    if (!headers.has("referrer-policy")) headers.set("referrer-policy", "strict-origin-when-cross-origin");
    if (!headers.has("permissions-policy")) headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  }
  return result;
});

export const startInstance = createStart(() => ({ requestMiddleware: [securityHeaders] }));
