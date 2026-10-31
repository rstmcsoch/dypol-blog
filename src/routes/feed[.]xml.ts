import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/feed.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Do not use readFeed(). It walks every block for full-text RSS and
        // throws on takeaways/table blocks (no .text), which made this URL
        // a 500. Google only indexes resources that return HTTP 200, and
        // this feed is linked from every page. Sitemap rows already have
        // the fields RSS needs, newest first.
        const { readSitemap } = await import("@/content/repository.server");
        const { rssXml } = await import("@/lib/seo");
        const { site } = await import("@/content/site");
        const { canonicalOriginFrom } = await import("@/lib/seo");
        const origin = canonicalOriginFrom(request.url);
        const data = await readSitemap();
        const articles = data.articles.slice(0, 20).map((article) => ({
          slug: article.slug,
          title: article.title,
          excerpt: article.excerpt,
          description: article.excerpt,
          publishedAt: article.publishedAt,
          updatedAt: article.updatedAt,
          topics: article.topics,
          coverMediaId: article.coverMediaId,
          authorName: article.authorName ?? null,
        }));
        const body = rssXml({
          origin,
          siteTitle: site.title,
          description: site.description,
          articles,
          publisher: site.publisher,
        });
        return new Response(body, {
          headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=900" },
        });
      },
    },
  },
});
