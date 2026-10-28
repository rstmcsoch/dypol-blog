import { createMiddleware, createStart } from "@tanstack/react-start";

/**
 * t79 (SEC-008): baseline security headers on every HTML response.
 * Deliberately no Content-Security-Policy: the app relies on inline theme
 * bootstrapping, and a mis-tuned CSP would break rendering; frame, MIME
 * sniffing, referrer and capability headers are safe to set globally.
 * (OAuth consent and /media already set their own stricter headers —
 * `set` here only fills the gaps, it does not weaken existing values.)
 */
const securityHeaders = createMiddleware().server(async ({ next }) => {
  const result = await next();
  const headers = result.response.headers;
  const type = headers.get("content-type") ?? "";
  if (type.includes("text/html")) {
    headers.set("cache-control", "no-store");
    if (!headers.has("strict-transport-security")) headers.set("strict-transport-security", "max-age=31536000");
    if (!headers.has("x-content-type-options")) headers.set("x-content-type-options", "nosniff");
    if (!headers.has("x-frame-options")) headers.set("x-frame-options", "SAMEORIGIN");
    if (!headers.has("referrer-policy")) headers.set("referrer-policy", "strict-origin-when-cross-origin");
    if (!headers.has("permissions-policy")) headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  }
  return result;
});

export const startInstance = createStart(() => ({ requestMiddleware: [securityHeaders] }));
