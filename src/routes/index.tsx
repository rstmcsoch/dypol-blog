import { createFileRoute } from "@tanstack/react-router";
import { HomeBlocks } from "@/components/site/blocks";
import { PagePending } from "@/components/site/states";
import { useSite } from "@/components/site/use-site";
import { getHome } from "@/content/public-api";
import { site as fallbackSite } from "@/content/site";

export const Route = createFileRoute("/")({
  loader: () => getHome(),
  head: () => ({
    meta: [
      { title: fallbackSite.title },
      { name: "description", content: fallbackSite.description },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  pendingComponent: PagePending,
  component: Home,
});

function Home() {
  const site = useSite();
  const { blocks, empty } = Route.useLoaderData();
  if (empty) {
    return (
      <div className="page">
        <div className="container">
          <h1 className="page-title">{site.name}</h1>
          <p className="lede">{site.labels.emptyBody}</p>
        </div>
      </div>
    );
  }
  return <HomeBlocks blocks={blocks} site={site} />;
}
