import { createFileRoute } from "@tanstack/react-router";

/**
 * t148: ad impression beacon (aggregated daily counters only, no personal data).
 *
 * It writes to D1, so it is held to the same rules as every other public write
 * endpoint in this app:
 *   - same-origin only (a cross-site page cannot inflate a sponsor's numbers);
 *   - headerless scripting clients are ignored, exactly like /api/views and
 *     /api/not-found, because a browser always sends fetch metadata;
 *   - `writesAllowed()` — a version-preview URL of the production Worker shares
 *     the production bindings and must stay read-only;
 *   - per-IP rate limit, because each accepted request costs a settings read
 *     plus up to 30 upserts.
 */
export const Route = createFileRoute("/api/ad-events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const none = new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
        const fetchSite = request.headers.get("sec-fetch-site");
        if (!origin && fetchSite !== "same-origin" && fetchSite !== "none") return none;
        const ua = (request.headers.get("user-agent") ?? "").toLowerCase();
        if (/bot|crawl|spider|preview|headless/.test(ua)) return none;
        try {
          const { workerEnv } = await import("@/lib/cf-env.server");
          const env = (await workerEnv()) as { MCP_LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> } };
          const ip = request.headers.get("cf-connecting-ip") ?? "local";
          if (env.MCP_LIMITER && !(await env.MCP_LIMITER.limit({ key: `adevents:${ip}` })).success) return none;
          const { writesAllowed } = await import("@/lib/write-guard.server");
          if (!(await writesAllowed())) return none;
        } catch {
          /* limiter or binding unavailable: skip the write rather than risk it */
          return none;
        }
        let body: unknown;
        try {
          const text = await request.text();
          if (text.length > 8000) return none;
          body = JSON.parse(text);
        } catch {
          return none;
        }
        const list = Array.isArray((body as { events?: unknown })?.events) ? ((body as { events: unknown[] }).events) : [];
        const events = list
          .map((e) => e as { slot?: unknown; creative?: unknown })
          .filter((e) => typeof e.slot === "string" && typeof e.creative === "string" && e.slot.length < 10 && e.creative.length < 60)
          .map((e) => ({ slot: e.slot as string, creative: e.creative as string, type: "imp" as const }));
        if (!events.length) return none;
        const { recordAdEvents } = await import("@/lib/ads/ads.server");
        // recordAdEvents() keeps only ids that exist in the current ads settings and caps the batch.
        await recordAdEvents(events).catch(() => 0);
        return none;
      },
    },
  },
});
