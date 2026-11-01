import { createFileRoute } from "@tanstack/react-router";

/** t148: ad impression beacon (aggregated daily counters only, no personal data). */
export const Route = createFileRoute("/api/ad-events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const none = new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
        const ua = (request.headers.get("user-agent") ?? "").toLowerCase();
        if (/bot|crawl|spider|preview|headless/.test(ua)) return none;
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
        await recordAdEvents(events).catch(() => 0);
        return none;
      },
    },
  },
});
