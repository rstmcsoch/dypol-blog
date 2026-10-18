import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/manifest.webmanifest")({
  server: {
    handlers: {
      GET: async () => {
        const { site } = await import("@/content/site");
        const body = JSON.stringify({
          name: site.title,
          short_name: site.name,
          description: site.description,
          start_url: "/",
          scope: "/",
          display: "standalone",
          background_color: "#ffffff",
          theme_color: "#111111",
          icons: [
            { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
            { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          ],
        });
        return new Response(body, {
          headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=86400" },
        });
      },
    },
  },
});
