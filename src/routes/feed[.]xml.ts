import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/feed.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readFeed } = await import("@/content/repository.server");
        const { rssXml } = await import("@/lib/seo");
        const { site } = await import("@/content/site");
        const { canonicalOriginFrom } = await import("@/lib/seo");
        const origin = canonicalOriginFrom(request.url);
        const articles = await readFeed(20);
        const body = rssXml({
          origin,
          siteTitle: site.title,
          description: site.description,
          articles,
        });
        return new Response(body, {
          headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=900" },
        });
      },
    },
  },
});
