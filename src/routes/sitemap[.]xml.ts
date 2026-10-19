import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readSitemap } = await import("@/content/repository.server");
        const { sitemapXml } = await import("@/lib/seo");
        const entries = await readSitemap();
        const { canonicalOriginFrom } = await import("@/lib/seo");
        const origin = canonicalOriginFrom(request.url);
        const newestArticle = entries.articles[0]?.lastmod ?? null;
        const newestTopic = entries.topics.reduce<string | null>((max, t) => (t.lastmod && (!max || t.lastmod > max) ? t.lastmod : max), null);
        const body = sitemapXml({
          origin,
          urls: [
            { path: "/", lastmod: newestArticle },
            { path: "/articles", lastmod: newestArticle },
            { path: "/topics", lastmod: newestTopic },
            { path: "/about", lastmod: (entries.pages ?? []).find((p) => p.slug === "about")?.lastmod ?? null },
            ...(entries.pages ?? []).filter((p) => p.slug !== "about").map((p) => ({ path: `/${p.slug}`, lastmod: p.lastmod ?? null })),
            ...entries.articles.map((a) => ({ path: `/articles/${a.slug}`, lastmod: a.lastmod, imagePath: a.coverMediaId ? `/media/${a.coverMediaId}` : null, imageTitle: a.title })),
            ...entries.topics.filter((t) => (t.count ?? 0) > 0).map((t) => ({ path: `/topics/${t.slug}`, lastmod: t.lastmod })),
          ],
        });
        return new Response(body, {
          headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
        });
      },
    },
  },
});
