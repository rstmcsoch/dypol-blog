import { useEffect } from "react";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { initArticleAnalytics } from "@/lib/analytics-beacon";
import { SpecialView } from "@/components/site/special-view";
import { AdPage, useSponsoredArticle } from "@/components/site/ads";
import { ArticlePagePending, NotFoundState } from "@/components/site/states";
import { useSite } from "@/components/site/use-site";
import { getSpecialArticle } from "@/content/public-api";
import { defaultOgPath, absoluteUrl, articleJsonLd, breadcrumbJsonLd, metaDescription, sitePageTitle, socialMeta } from "@/lib/seo";

export const Route = createFileRoute("/special/$slug")({
  loader: async ({ params }) => {
    const data = await getSpecialArticle({ data: { slug: params.slug } });
    if (!data) throw notFound();
    if ("redirectTo" in data && data.redirectTo) throw redirect({ to: "/special/$slug", params: { slug: data.redirectTo }, statusCode: 301 });
    if (!("article" in data) || !data.article) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: sitePageTitle("Not found") }, { name: "robots", content: "noindex" }] };
    const { article } = loaderData;
    const origin = loaderData.origin ?? "";
    const path = `/special/${article.slug}`;
    const title = sitePageTitle(article.seoTitle ?? article.title, loaderData.site.name);
    const description = metaDescription(article.seoDescription ?? article.excerpt, article.title);
    const topics = (loaderData.topics ?? []).map((t) => t.label);
    const url = absoluteUrl(origin, path);
    const cover = article.coverMediaId ? absoluteUrl(origin, `/media/${article.coverMediaId}`) : absoluteUrl(origin, defaultOgPath(loaderData.site));
    const ld = {
      ...articleJsonLd({
        origin,
        siteName: loaderData.site.name,
        publisher: loaderData.site.publisher,
        logoMediaId: loaderData.site.logoMediaId,
        article: {
          slug: article.slug, path, title: article.title, excerpt: article.excerpt, description,
          publishedAt: article.publishedAt, updatedAt: article.updatedAt, topics,
          coverMediaId: article.coverMediaId ?? null, authorName: article.authorName ?? null,
        },
      }),
      "@type": "Article",
      ...(article.wordCount ? { wordCount: article.wordCount } : {}),
      ...(loaderData.body.sources.length ? { citation: loaderData.body.sources.slice(0, 50).map((s) => ({ "@type": "CreativeWork", name: s.title, url: s.url })) } : {}),
    };
    const crumbs = breadcrumbJsonLd({
      origin,
      items: [
        { name: "Home", path: "/" },
        { name: "Special reports", path: "/special" },
        { name: article.title, path },
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
      links: [{ rel: "canonical", href: url }],
      scripts: [
        { type: "application/ld+json", children: JSON.stringify(ld) },
        { type: "application/ld+json", children: JSON.stringify(crumbs) },
      ],
    };
  },
  pendingComponent: ArticlePagePending,
  pendingMs: 200,
  pendingMinMs: 400,
  notFoundComponent: NotFoundState,
  component: SpecialPage,
});

function SpecialPage() {
  const site = useSite();
  const data = Route.useLoaderData();
  const slug = data.article.slug;
  useEffect(() => {
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
    const { teardown } = initArticleAnalytics({ articleId: data.article.id, path: `/special/${slug}` });
    return teardown;
  }, [data.article.id, slug]);
  const sponsored = useSponsoredArticle(slug);
  const topics = [data.category, ...(data.topics ?? [])].flatMap((c) => (c ? [c.slug] : []));
  return (
    <AdPage page={{ type: "article", slug, topics, sponsored }}>
      <SpecialView {...data} site={site} />
    </AdPage>
  );
}
