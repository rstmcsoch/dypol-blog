import { createFileRoute, notFound } from "@tanstack/react-router";
import { IndexList } from "@/components/site/index-list";
import { EmptyState, NotFoundState, PagePending } from "@/components/site/states";
import { site } from "@/content/site";
import { getCategory, listPublishedByCategory } from "@/content/queries";

export const Route = createFileRoute("/topics/$slug")({
  loader: ({ params }) => {
    const category = getCategory(params.slug);
    if (!category) throw notFound();
    return { category, articles: listPublishedByCategory(params.slug) };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    return {
      meta: [
        { title: `${loaderData.category.label} — ${site.name}` },
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
  const { category, articles } = Route.useLoaderData();
  return (
    <div className="page">
      <div className="container">
        <header className="page-header">
          <p className="kicker">{site.labels.topicsKicker}</p>
          <h1 className="page-title">{category.label}</h1>
          <p className="lede">{category.description}</p>
        </header>
        {articles.length > 0 ? <IndexList articles={articles} /> : <EmptyState />}
      </div>
    </div>
  );
}
