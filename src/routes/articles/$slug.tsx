import { useEffect } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { initArticleAnalytics } from "@/lib/analytics-beacon";
import { ArticleView } from "@/components/site/article-view";
import { ArticlePagePending, NotFoundState } from "@/components/site/states";
import { useSite } from "@/components/site/use-site";
import { getArticle } from "@/content/public-api";
import { absoluteUrl, articleJsonLd, breadcrumbJsonLd, metaDescription, sitePageTitle, socialMeta } from "@/lib/seo";

export const Route = createFileRoute("/articles/$slug")({
  loader: async ({ params }) => {
    const data = await getArticle({ data: { slug: params.slug } });
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: sitePageTitle("Article") }] };
    const { article } = loaderData;
    const origin = loaderData.origin ?? "";
    const title = sitePageTitle(article.seoTitle ?? article.title);
    const description = metaDescription(article.seoDescription ?? article.excerpt, article.title);
    const topics = (loaderData.topics ?? []).map((t) => t.label);
    const url = absoluteUrl(origin, `/articles/${article.slug}`);
    const cover = article.coverMediaId ? absoluteUrl(origin, `/media/${article.coverMediaId}`) : null;
    const newsLd = articleJsonLd({
      origin,
      siteName: "DYPOL Blog",
      publisher: "DYPOL Blog",
      authorName: "DYPOL Labs",
      article: {
        slug: article.slug, title: article.title, excerpt: article.excerpt, description,
        publishedAt: article.publishedAt, updatedAt: article.updatedAt, topics,
        coverMediaId: article.coverMediaId ?? null,
      },
    });
    const crumbs = breadcrumbJsonLd({
      origin,
      items: [
        { name: "Home", path: "/" },
        { name: "Topics", path: "/topics" },
        ...(loaderData.category ? [{ name: loaderData.category.label, path: `/topics/${loaderData.category.slug}` }] : []),
        { name: article.title, path: `/articles/${article.slug}` },
      ],
    });
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...socialMeta({
          title, description, url, type: "article", siteName: "DYPOL Blog", image: cover,
          publishedAt: article.publishedAt, modifiedAt: article.updatedAt, section: topics[0], imageAlt: article.coverAlt ?? article.title,
        }),
      ],
      links: [
        { rel: "canonical", href: url },
        // t88: preload the article hero (LCP element) alongside the eager img.
        ...(cover ? [{ rel: "preload", as: "image", href: cover, fetchPriority: "high" } as const] : []),
      ],
      scripts: [
        { type: "application/ld+json", children: JSON.stringify(newsLd) },
        { type: "application/ld+json", children: JSON.stringify(crumbs) },
      ],
    };
  },
  // Show the article-shaped skeleton promptly on an uncached client-side
  // navigation (prefetch on intent usually makes this unnecessary).
  pendingComponent: ArticlePagePending,
  pendingMs: 200,
  pendingMinMs: 400,
  notFoundComponent: NotFoundState,
  component: ArticlePage,
});

function ArticlePage() {
  const site = useSite();
  const data = Route.useLoaderData();
  const slug = data.article.slug;
  useEffect(() => {
    // One anonymous count per article view (see /api/views). Ignored if it fails.
    const key = `dypol-viewed:${slug}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* private mode: still count */
    }
    void fetch(`/api/views/${slug}`, { method: "POST", keepalive: true }).catch(() => undefined);
  }, [slug]);
  useEffect(() => {
    // First-party engagement beacon for the Stats dashboard (opt-in style:
    // one small aggregated ping per session per article, no personal data).
    const { teardown } = initArticleAnalytics({
      articleId: data.article.id,
      path: `/articles/${slug}`,
    });
    return teardown;
  }, [data.article.id, slug]);
  return <ArticleView {...data} site={site} />;
}