import { createFileRoute } from "@tanstack/react-router";
import { PagePending } from "@/components/site/states";
import { TopicGrid } from "@/components/site/topic-grid";
import { site } from "@/content/site";

export const Route = createFileRoute("/topics/")({
  head: () => ({
    meta: [
      { title: `${site.labels.topicsTitle} — ${site.name}` },
      { name: "description", content: site.labels.topicsLede },
    ],
    links: [{ rel: "canonical", href: "/topics" }],
  }),
  pendingComponent: PagePending,
  component: TopicsPage,
});

function TopicsPage() {
  return (
    <div className="page">
      <div className="container">
        <header className="page-header">
          <p className="kicker">{site.labels.topicsKicker}</p>
          <h1 className="page-title">{site.labels.topicsTitle}</h1>
          <p className="lede">{site.labels.topicsLede}</p>
        </header>
        <TopicGrid />
      </div>
    </div>
  );
}
