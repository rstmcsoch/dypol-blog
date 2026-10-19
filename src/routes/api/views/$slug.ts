import { createFileRoute } from "@tanstack/react-router";

type Limiter = { limit(input: { key: string }): Promise<{ success: boolean }> };

/**
 * Privacy-friendly view counter: POST /api/views/<slug> adds 1 to that article.
 * Stores only a per-article integer (no IP, cookie, user agent or timestamp per
 * visit). Same-origin only; one count per IP+article per rate window (the IP is
 * used for the limiter key in memory and never stored).
 */
async function count(request: Request, slug: string): Promise<Response> {
  const none = new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return none;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  // t79 (SEC-003): headerless script POSTs (no Origin AND no same-origin
  // fetch metadata) are silently not counted; browsers always send one.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin && fetchSite !== "same-origin" && fetchSite !== "none") return none;
  const ua = request.headers.get("user-agent") ?? "";
  if (/bot|crawl|spider|slurp|facebookexternalhit|preview/i.test(ua)) return none;
  const { workerEnv } = await import("@/lib/cf-env.server");
  const { writesAllowed } = await import("@/lib/write-guard.server");
  if (!(await writesAllowed())) return none;
  const env = (await workerEnv()) as { MCP_LIMITER?: Limiter };
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  if (env.MCP_LIMITER) {
    const { success } = await env.MCP_LIMITER.limit({ key: `view:${ip}:${slug}` });
    if (!success) return none;
  }
  try {
    const { recordView } = await import("@/content/repository.server");
    await recordView(slug);
  } catch (error) {
    console.error("[views] not counted", error instanceof Error ? error.message : "unknown");
  }
  return none;
}

export const Route = createFileRoute("/api/views/$slug")({
  server: {
    handlers: {
      POST: async ({ request, params }) => count(request, params.slug),
    },
  },
});
