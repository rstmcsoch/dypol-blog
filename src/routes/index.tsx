import { createFileRoute } from "@tanstack/react-router";
import { HomeBlock } from "@/components/site/block-render";
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

/**
 * The homepage is whatever the Homepage Builder published: an ordered list of
 * resolved blocks. When the layout has no hero, a screen-reader heading keeps
 * the page structure intact.
 */
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

  const hasHeading = blocks.some((block) => block.kind === "hero");
  return (
    <>
      {hasHeading ? null : <h1 className="sr-only">{site.name}</h1>}
      {blocks.map((block) => (
        <HomeBlock key={block.block.id} resolved={block} site={site} />
      ))}
    </>
  );
}
