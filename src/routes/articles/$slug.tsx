import { useEffect } from "react";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { initArticleAnalytics } from "@/lib/analytics-beacon";
import { ArticleView } from "@/components/site/article-view";
import { ArticlePagePending, NotFoundState } from "@/components/site/states";
import { useSite } from "@/components/site/use-site";
import { getArticle } from "@/content/public-api";
import { defaultOgPath, absoluteUrl, articleJsonLd, breadcrumbJsonLd, metaDescription, sitePageTitle, socialMeta } from "@/lib/seo";

export const Route = createFileRoute("/articles/$slug")({
  loader: async ({ params }) => {
    const data = await getArticle({ data: { slug: params.slug } });
    if (!data) throw notFound();
    if ("redirectTo" in data && data.redirectTo) throw redirect({ to: "/articles/$slug", params: { slug: data.redirectTo }, statusCode: 301 });
    if (!("article" in data) || !data.article) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: sitePageTitle("Not found") }, { name: "robots", content: "noindex" }] };
    const { article } = loaderData;
    const origin = loaderData.origin ?? "";
    const title = sitePageTitle(article.seoTitle ?? article.title, loaderData.site.name);
    const description = metaDescription(article.seoDescription ?? article.excerpt, article.title);
    const topics = (loaderData.topics ?? []).map((t) => t.label);
    const url = absoluteUrl(origin, `/articles/${article.slug}`);
    const cover = article.coverMediaId ? absoluteUrl(origin, `/media/${article.coverMediaId}`) : absoluteUrl(origin, defaultOgPath(loaderData.site));
    const newsLd = articleJsonLd({
      origin,
      siteName: loaderData.site.name,
      publisher: loaderData.site.publisher,
      logoMediaId: loaderData.site.logoMediaId,
      article: {
        slug: article.slug, title: article.title, excerpt: article.excerpt, description,
        publishedAt: article.publishedAt, updatedAt: article.updatedAt, topics,
        coverMediaId: article.coverMediaId ?? null,
        authorName: article.authorName ?? null,
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
        { name: "author", content: article.authorName?.trim() || loaderData.site.publisher },
        ...socialMeta({
          title, description, url, type: "article", siteName: loaderData.site.name, image: cover,
          publishedAt: article.publishedAt, modifiedAt: article.updatedAt, section: topics[0], imageAlt: article.coverAlt ?? article.title,
        }),
      ],
      links: [
        { rel: "canonical", href: url },
        // t147: React 19 hoists the hero <img> preload itself (fetchPriority=high).
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