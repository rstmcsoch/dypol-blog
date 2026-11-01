import { createFileRoute } from "@tanstack/react-router";

/** t148: /ads.txt, edited in Admin → Ads → Scripts & ads.txt. 404 while empty. */
export const Route = createFileRoute("/ads.txt")({
  server: {
    handlers: {
      GET: async () => {
        const { publicAdsSettings } = await import("@/lib/ads/ads.server");
        const text = (await publicAdsSettings()).adsTxt.trim();
        if (!text) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
        return new Response(`${text}\n`, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
      },
    },
  },
});
