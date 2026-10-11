import { createFileRoute } from "@tanstack/react-router";
import { IndexList } from "@/components/site/index-list";
import { PagePending } from "@/components/site/states";
import { useSite } from "@/components/site/use-site";
import { getIndex } from "@/content/public-api";

export const Route = createFileRoute("/articles/")({
  loader: () => getIndex(),
  head: () => ({
    meta: [
      { title: "Index — DYPOL Blog" },
      { name: "description", content: "Every published piece, newest first." },
    ],
    links: [{ rel: "canonical", href: "/articles" }],
  }),
  pendingComponent: PagePending,
  component: ArticlesPage,
});

function ArticlesPage() {
  const site = useSite();
  const { articles, meta } = Route.useLoaderData();
  return (
    <div className="page">
      <div className="container">
        <header className="page-header">
          <p className="kicker">{site.labels.indexKicker}</p>
          <h1 className="page-title">{site.labels.indexTitle}</h1>
          <p className="lede">{site.labels.indexLede}</p>
        </header>
        <IndexList articles={articles} meta={meta} minRead={site.labels.minRead} />
      </div>
    </div>
  );
}