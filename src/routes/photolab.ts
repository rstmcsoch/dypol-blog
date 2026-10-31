import { createFileRoute } from "@tanstack/react-router";
import pageHtml from "../content/photolab.html?raw";

/**
 * Standalone Lens Division page. Full document, intentionally unlisted:
 * no nav, footer, or sitemap entry. The HTML is bundled so the page does not
 * depend on a second fetch at request time.
 */
export const Route = createFileRoute("/photolab")({
  server: {
    handlers: {
      GET: async () =>
        new Response(pageHtml, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=300",
          },
        }),
    },
  },
});
