import { createFileRoute } from "@tanstack/react-router";
import pageHtml from "../content/photolab.html?raw";

/** Standalone Lens Division page. Full document, not linked from nav, footer, or sitemap. */
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
