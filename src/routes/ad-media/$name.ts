import { createFileRoute } from "@tanstack/react-router";

/** t148: sponsor banner files from R2 (keys ads/<uuid>.<ext>), immutable. */
export const Route = createFileRoute("/ad-media/$name")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { serveAdMedia } = await import("@/lib/ads/ads.server");
        try {
          return await serveAdMedia(params.name);
        } catch {
          return new Response("Not found", { status: 404 });
        }
      },
    },
  },
});
