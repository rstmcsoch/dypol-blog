import { createFileRoute } from "@tanstack/react-router";

/** t148: sponsor click-through — counts the click, then 302 to the sponsor (with UTM). */
export const Route = createFileRoute("/ad-click/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { resolveAdClick } = await import("@/lib/ads/ads.server");
        const slot = new URL(request.url).searchParams.get("s") ?? "";
        const target = await resolveAdClick(params.id, slot).catch(() => null);
        if (!target) return new Response(null, { status: 302, headers: { location: "/", "cache-control": "no-store" } });
        return new Response(null, { status: 302, headers: { location: target, "cache-control": "no-store", "x-robots-tag": "noindex" } });
      },
    },
  },
});
