import { createFileRoute } from "@tanstack/react-router";
import { PagePending } from "@/components/site/states";
import { TopicGrid } from "@/components/site/topic-grid";
import { useSite } from "@/components/site/use-site";
import { getTopics } from "@/content/public-api";

export const Route = createFileRoute("/topics/")({
  loader: () => getTopics(),
  head: () => ({
    meta: [
      { title: "Topics — DYPOL Blog" },
      { name: "description", content: "Pieces are filed by subject." },
    ],
    links: [{ rel: "canonical", href: "/topics" }],
  }),
  pendingComponent: PagePending,
  component: TopicsPage,
});

function TopicsPage() {
  const site = useSite();
  const { topics } = Route.useLoaderData();
  return (
    <div className="page">
      <div className="container">
        <header className="page-header">
          <p className="kicker">{site.labels.topicsKicker}</p>
          <h1 className="page-title">{site.labels.topicsTitle}</h1>
          <p className="lede">{site.labels.topicsLede}</p>
        </header>
        <TopicGrid topics={topics} />
      </div>
    </div>
  );
}