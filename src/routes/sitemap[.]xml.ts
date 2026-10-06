import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readSitemap } = await import("@/content/repository.server");
        const entries = await readSitemap();
        const origin = new URL(request.url).origin;
        const paths = [
          "/",
          "/articles",
          "/topics",
          "/about",
          ...entries.articles.map((slug) => `/articles/${slug}`),
          ...entries.topics.map((slug) => `/topics/${slug}`),
        ];
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((path) => `  <url><loc>${origin}${path}</loc></url>`).join("\n")}
</urlset>
`;
        return new Response(body, {
          headers: { "content-type": "application/xml; charset=utf-8" },
        });
      },
    },
  },
});
