import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readSitemap } = await import("@/content/repository.server");
        const { sitemapXml } = await import("@/lib/seo");
        const entries = await readSitemap();
        const origin = new URL(request.url).origin;
        const newestArticle = entries.articles[0]?.lastmod ?? null;
        const newestTopic = entries.topics.reduce<string | null>((max, t) => (t.lastmod && (!max || t.lastmod > max) ? t.lastmod : max), null);
        const body = sitemapXml({
          origin,
          urls: [
            { path: "/", lastmod: newestArticle },
            { path: "/articles", lastmod: newestArticle },
            { path: "/topics", lastmod: newestTopic },
            { path: "/about", lastmod: null },
            ...entries.articles.map((a) => ({ path: `/articles/${a.slug}`, lastmod: a.lastmod })),
            ...entries.topics.map((t) => ({ path: `/topics/${t.slug}`, lastmod: t.lastmod })),
          ],
        });
        return new Response(body, {
          headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
        });
      },
    },
  },
});
