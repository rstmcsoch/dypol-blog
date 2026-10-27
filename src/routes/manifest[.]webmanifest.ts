import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/manifest.webmanifest")({
  server: {
    handlers: {
      GET: async () => {
        const { site } = await import("@/content/site");
        const body = JSON.stringify({
          name: "DYPOL BLOG",
          short_name: "DYPOL BLOG",
          description: site.description,
          start_url: "/",
          scope: "/",
          display: "standalone",
          background_color: "#ffffff",
          theme_color: "#111111",
          icons: [
            { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
            { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          ],
        });
        return new Response(body, {
          // PWA names can remain cached in browser install prompts. Always revalidate
          // this identity document so a branding change reaches the install UI.
          headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "no-cache, max-age=0, must-revalidate" },
        });
      },
    },
  },
});
