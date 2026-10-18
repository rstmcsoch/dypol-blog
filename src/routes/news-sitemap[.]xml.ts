import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/news-sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readSitemap } = await import("@/content/repository.server");
        const { newsSitemapXml } = await import("@/lib/seo");
        const { site } = await import("@/content/site");
        const entries = await readSitemap();
        const origin = new URL(request.url).origin;
        const body = newsSitemapXml({
          origin,
          publicationName: site.name,
          articles: entries.articles.map((a) => ({
            slug: a.slug, title: a.title, excerpt: a.excerpt, description: a.excerpt,
            publishedAt: a.publishedAt, updatedAt: a.updatedAt, topics: a.topics, coverMediaId: a.coverMediaId,
          })),
        });
        return new Response(body, {
          headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=900" },
        });
      },
    },
  },
});
