import { createFileRoute, notFound } from "@tanstack/react-router";
import { IndexList } from "@/components/site/index-list";
import { EmptyState, NotFoundState, PagePending } from "@/components/site/states";
import { useSite } from "@/components/site/use-site";
import { getTopic } from "@/content/public-api";

export const Route = createFileRoute("/topics/$slug")({
  loader: async ({ params }) => {
    const data = await getTopic({ data: { slug: params.slug } });
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Topics — DYPOL Blog" }] };
    return {
      meta: [
        { title: `${loaderData.category.label} — DYPOL Blog` },
        { name: "description", content: loaderData.category.description },
      ],
      links: [{ rel: "canonical", href: `/topics/${loaderData.category.slug}` }],
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