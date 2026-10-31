import { createFileRoute } from "@tanstack/react-router";

const PAGE_URL = "https://raw.githubusercontent.com/rstmcsoch/dypol-blog/main/src/content/photolab.html";

/**
 * Standalone Lens Division page. Full document, intentionally unlisted:
 * no nav, footer, or sitemap entry.
 */
export const Route = createFileRoute("/photolab")({
  server: {
    handlers: {
      GET: async () => {
        const upstream = await fetch(PAGE_URL, { headers: { "user-agent": "dypol-blog" } });
        if (!upstream.ok) return new Response("Not found", { status: 404 });
        return new Response(await upstream.text(), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=300",
          },
        });
      },
    },
  },
});
