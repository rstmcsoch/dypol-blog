import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/manifest.webmanifest")({
  server: {
    handlers: {
      GET: async () => {
        const { readShell } = await import("@/content/repository.server");
        const { themeColors } = await import("@/lib/appearance");
        const { site } = await readShell();
        const colors = themeColors(site.appearance);
        const body = JSON.stringify({
          name: site.name,
          short_name: site.name,
          description: site.description,
          start_url: "/",
          scope: "/",
          display: "standalone",
          background_color: colors.light.paper,
          theme_color: site.appearance.accent,
          icons: site.faviconMediaId ? [{ src: `/media/${site.faviconMediaId}`, sizes: "any", purpose: "any" }] : [
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
