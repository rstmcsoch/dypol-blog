import { createFileRoute, notFound } from "@tanstack/react-router";
import { ArticleView } from "@/components/site/article-view";
import { NotFoundState, PagePending } from "@/components/site/states";
import { useSite } from "@/components/site/use-site";
import { getArticle } from "@/content/public-api";

export const Route = createFileRoute("/articles/$slug")({
  loader: async ({ params }) => {
    const data = await getArticle({ data: { slug: params.slug } });
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "DYPOL Blog" }] };
    const { article } = loaderData;
    const title = article.seoTitle ?? `${article.title} — DYPOL Blog`;
    const description = article.seoDescription ?? article.excerpt;
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: article.title,
      description,
      datePublished: article.publishedAt,
      dateModified: article.updatedAt,
      articleSection: loaderData.category?.label,
      publisher: { "@type": "Organization", name: "DYPOL Labs" },
    };
    return {
      meta: [
        { title },
        { name: "description", content: description },
      ],
      links: [{ rel: "canonical", href: `/articles/${article.slug}` }],
      scripts: [{ type: "application/ld+json", children: JSON.stringify(jsonLd) }],
    };
  },
  pendingComponent: PagePending,
  notFoundComponent: NotFoundState,
  component: ArticlePage,
});

function ArticlePage() {
  const site = useSite();
  const data = Route.useLoaderData();
  return <ArticleView {...data} site={site} />;
}