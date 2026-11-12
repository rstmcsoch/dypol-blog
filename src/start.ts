import { createMiddleware, createStart } from "@tanstack/react-start";
import { workerEnv } from "@/lib/cf-env.server";
import { compactHeadBlock, headBlock, isCmpPath } from "@/lib/ads/cmp";

/**
 * t79 (SEC-008): baseline security headers on every HTML response.
 * Deliberately no Content-Security-Policy: the app relies on inline theme
 * bootstrapping, and a mis-tuned CSP would break rendering; frame, MIME
 * sniffing, referrer and capability headers are safe to set globally.
 * (OAuth consent and /media already set their own stricter headers —
 * `set` here only fills the gaps, it does not weaken existing values.)
 */
// Workers' streaming HTML rewriter (workerd global; absent in plain Node).
type RwEl = { remove(): void; after(h: string, o: { html: boolean }): void; before(h: string, o: { html: boolean }): void; onEndTag(fn: (e: RwEl) => void): void };
type Rw = { on(sel: string, h: { element(el: RwEl): void }): Rw; transform(r: Response): Response };
const Rewriter = (globalThis as unknown as { HTMLRewriter?: new () => Rw }).HTMLRewriter;

/**
 * Safe-subset Content-Security-Policy applied to every response that does not
 * set its own. See the header block below for why no source lists are declared.
 */
const BASE_CSP = "object-src 'none'; base-uri 'self'";

const securityHeaders = createMiddleware().server(async ({ request, pathname, next }) => {
  // Grok discovers OAuth by probing the MCP path, not only the issuer root.
  // An HTML 404 on any of these aborts connect before the consent page opens.
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  // t140: the blog moved to blog.dypol.workers.dev. Any request that still
  // reaches an old production host 301s to the same path on the new origin.
  const reqUrl = new URL(request.url);
  if (/^(dypolblog|dypol-blog)\.rstmcsoch\.workers\.dev$/i.test(reqUrl.hostname)) {
    return new Response(null, { status: 301, headers: { location: `https://blog.dypol.workers.dev${reqUrl.pathname}${reqUrl.search}`, "x-robots-tag": "noindex" } });
  }
  if ((request.method === "GET" || request.method === "HEAD") && path === "/rss.xml") {
    return new Response(null, { status: 301, headers: { location: "/feed.xml" } });
  }
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
        // These responses return before the baseline header block below, so the
        // sniffing guard is applied here for the gallery frames.
        headers.set("x-content-type-options", "nosniff");
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
  let result = await next();
  const headers = result.response.headers;
  // t140: only the canonical host is indexable. Version / branch preview
  // hosts (*-blog.dypol.workers.dev etc.) get noindex on every response.
  if (reqUrl.hostname.endsWith(".workers.dev") && reqUrl.hostname !== "blog.dypol.workers.dev") {
    try { headers.set("x-robots-tag", "noindex, nofollow"); } catch { /* immutable headers */ }
  }
  const type = headers.get("content-type") ?? "";
  if (type.includes("text/html") && request.method === "GET" && isCmpPath(path) && Rewriter) {
    // t161: the certified consent tool's head code goes first in <head>
    // (right after <meta charset>), ahead of every other script, ad hint and
    // gtag/GTM tag, on every public page whether ads are on or off.
    // t164: then the owner's Settings → Custom head code (verification tags,
    // analytics, …), still inside <head> and independent of the ads switch.
    const [{ publicAdsSettings }, { publicCustomHead }] = await Promise.all([import("@/lib/ads/ads.server"), import("@/content/repository.server")]);
    const [cmp, custom] = await Promise.all([
      publicAdsSettings().then((s) => s.consent.cmpHead.trim(), () => ""),
      publicCustomHead().catch(async () => (await import("@/content/site")).site.customHead),
    ]);
    const block = headBlock(cmp, custom);
    if (block) {
      const html = compactHeadBlock(block);
      let placed = false;
      const response = new Rewriter()
        // React's hydration mirrors of the block (see CmpHeadMirror) are dropped from the HTML.
        .on("[data-cmp-mirror]", { element(el: RwEl) { el.remove(); } })
        .on("meta[charset]", { element(el: RwEl) { if (!placed) { el.after(html, { html: true }); placed = true; } } })
        .on("head", { element(el: RwEl) { el.onEndTag((end: RwEl) => { if (!placed) { end.before(html, { html: true }); placed = true; } }); } })
        .transform(result.response);
      // Hand the SSR stream's cleanup ownership to the rewritten body.
      const { transferResponseBodyOwnership } = await import("@tanstack/react-start/server");
      result = { ...result, response: transferResponseBodyOwnership(result.response, response) };
    }
  }
  if (type.includes("text/html")) {
    // Admin, preview and auth pages must never be cached. Public pages get a
    // short shared cache so they stay fast while settings changes still show
    // within about a minute.
    const path = new URL(request.url).pathname;
    const privatePath = /^\/(admin|preview|oauth|api|auth)(\/|$)/.test(path);
    if (privatePath) headers.set("cache-control", "no-store");
    else if (!headers.has("cache-control")) headers.set("cache-control", "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
  }
  // Baseline headers on every response, not only HTML documents: JSON, XML,
  // images, fonts and redirects are all sniffable/collectable too, and several
  // of them are reached from URLs an attacker can plant. A route that already
  // set a stricter value always wins (the `has` guards), so this only fills
  // gaps. Wrapped because some platform-built Responses expose immutable
  // headers, and a header is never worth failing a request over.
  try {
    if (!headers.has("strict-transport-security")) headers.set("strict-transport-security", "max-age=31536000");
    if (!headers.has("x-content-type-options")) headers.set("x-content-type-options", "nosniff");
    if (!headers.has("referrer-policy")) headers.set("referrer-policy", "strict-origin-when-cross-origin");
    if (!headers.has("permissions-policy")) headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
    // This is the safe subset of CSP, not a full policy: it names no script,
    // style, image or connect source, so the inline theme bootstrap, the ads
    // runtime, GA, the consent tool's head code and social embeds are
    // unaffected. What it does close off is `<base>` retargeting every relative
    // URL on the page and plugin documents (Flash/PDF/Java) being embedded as
    // the document itself. Routes with their own stricter CSP (OAuth consent,
    // /media, special-charts) keep it.
    if (!headers.has("content-security-policy")) headers.set("content-security-policy", BASE_CSP);
    if (type.includes("text/html") && !headers.has("x-frame-options")) headers.set("x-frame-options", "SAMEORIGIN");
  } catch {
    /* immutable headers: the response is already safe to send */
  }
  return result;
});

export const startInstance = createStart(() => ({ requestMiddleware: [securityHeaders] }));
