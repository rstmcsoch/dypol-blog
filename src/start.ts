import { createMiddleware, createStart } from "@tanstack/react-start";
import { workerEnv } from "@/lib/cf-env.server";

/**
 * t79 (SEC-008): baseline security headers on every HTML response.
 * Deliberately no Content-Security-Policy: the app relies on inline theme
 * bootstrapping, and a mis-tuned CSP would break rendering; frame, MIME
 * sniffing, referrer and capability headers are safe to set globally.
 * (OAuth consent and /media already set their own stricter headers —
 * `set` here only fills the gaps, it does not weaken existing values.)
 */
const securityHeaders = createMiddleware().server(async ({ request, pathname, next }) => {
  // Grok discovers OAuth by probing the MCP path, not only the issuer root.
  // An HTML 404 on any of these aborts connect before the consent page opens.
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if ((request.method === "GET" || request.method === "HEAD") && (path === "/photolab" || path.startsWith("/photolab/"))) {
    const file = path === "/photolab" ? "page.html" : path.slice("/photolab/".length);
    if (file && !file.includes("..") && !file.includes("/")) {
      const env = await workerEnv();
      const media = env.MEDIA as { get?: (key: string) => Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null> } | undefined;
      const obj = media?.get ? await media.get(`_photolab/${file}`) : null;
      if (obj) {
        const headers = new Headers();
        headers.set("content-type", path === "/photolab" ? "text/html; charset=utf-8" : obj.httpMetadata?.contentType || "image/jpeg");
        headers.set("cache-control", path === "/photolab" ? "public, max-age=300" : "public, max-age=86400");
        return new Response(request.method === "HEAD" ? null : obj.body, { headers });
      }
    }
  }
  if (
    request.method !== "POST" &&
    (path === "/.well-known/oauth-authorization-server/mcp" ||
      path === "/.well-known/openid-configuration" ||
      path === "/.well-known/openid-configuration/mcp" ||
      path === "/mcp/.well-known/openid-configuration" ||
      path === "/mcp/.well-known/oauth-authorization-server")
  ) {
    const oauth = await import("@/lib/mcp/oauth.server");
    if (request.method === "OPTIONS") return oauth.preflight();
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers: { allow: "GET, HEAD, OPTIONS" } });
    }
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
