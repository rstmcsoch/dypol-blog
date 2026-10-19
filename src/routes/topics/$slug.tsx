import { createFileRoute, notFound } from "@tanstack/react-router";
import { IndexList } from "@/components/site/index-list";
import { EmptyState, NotFoundState, PagePending } from "@/components/site/states";
import { useSite } from "@/components/site/use-site";
import { getTopic } from "@/content/public-api";
import { absoluteUrl, breadcrumbJsonLd, itemListJsonLd, socialMeta, topicMetaDescription } from "@/lib/seo";

export const Route = createFileRoute("/topics/$slug")({
  loader: async ({ params }) => {
    const data = await getTopic({ data: { slug: params.slug } });
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Topics — DYPOL Blog" }] };
    const origin = loaderData.origin ?? "";
    const title = `${loaderData.category.label} — DYPOL Blog`;
    const description = topicMetaDescription(loaderData.category.label, loaderData.category.description);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        // A topic with nothing published yet is a thin/empty hub: keep it
        // crawlable for discovery but out of the index until it has stories.
        ...(loaderData.articles.length === 0 ? [{ name: "robots", content: "noindex, follow" }] : []),
        ...socialMeta({ title, description, url: absoluteUrl(origin, `/topics/${loaderData.category.slug}`), type: "website", siteName: "DYPOL Blog", image: absoluteUrl(origin, "/og.jpg") }),
      ],
      links: [{ rel: "canonical", href: absoluteUrl(origin, `/topics/${loaderData.category.slug}`) }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(
            breadcrumbJsonLd({ origin, items: [{ name: "Home", path: "/" }, { name: "Topics", path: "/topics" }, { name: loaderData.category.label, path: `/topics/${loaderData.category.slug}` }] }),
          ),
        },
        {
          type: "application/ld+json",
          children: JSON.stringify(
            itemListJsonLd({ origin, items: loaderData.articles.map((a) => ({ name: a.title, path: `/articles/${a.slug}` })) }),
          ),
        },
      ],
    };
  },
  pendingComponent: PagePending,
  notFoundComponent: NotFoundState,
  component: TopicPage,
});

function TopicPage() {
  const site = useSite();
  const { category, articles, meta } = Route.useLoaderData();
  return (
    <div className="page">
      <div className="container">
        <header className="page-header">
          <p className="kicker">{site.labels.topicsKicker}</p>
          <h1 className="page-title">{category.label}</h1>
          <p className="lede">{category.description}</p>
        </header>
        {articles.length > 0 ? (
          <IndexList articles={articles} meta={meta} minRead={site.labels.minRead} />
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}