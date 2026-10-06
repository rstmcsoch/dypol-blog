import { createFileRoute } from "@tanstack/react-router";
import { IndexList } from "@/components/site/index-list";
import { PagePending } from "@/components/site/states";
import { site } from "@/content/site";
import { listPublished } from "@/content/queries";

export const Route = createFileRoute("/articles/")({
  loader: () => ({ articles: listPublished() }),
  head: () => ({
    meta: [
      { title: `${site.labels.indexTitle} — ${site.name}` },
      { name: "description", content: site.labels.indexLede },
    ],
    links: [{ rel: "canonical", href: "/articles" }],
  }),
  pendingComponent: PagePending,
  component: ArticlesPage,
});

function ArticlesPage() {
  const { articles } = Route.useLoaderData();
  return (
    <div className="page">
      <div className="container">
        <header className="page-header">
          <p className="kicker">{site.labels.indexKicker}</p>
          <h1 className="page-title">{site.labels.indexTitle}</h1>
          <p className="lede">{site.labels.indexLede}</p>
        </header>
        <IndexList articles={articles} />
      </div>
    </div>
  );
}
