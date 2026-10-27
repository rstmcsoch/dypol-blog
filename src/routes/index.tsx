import { createFileRoute } from "@tanstack/react-router";
import { HomeBlocks } from "@/components/site/blocks";
import { PagePending } from "@/components/site/states";
import { useSite } from "@/components/site/use-site";
import { getHome } from "@/content/public-api";
import { site as fallbackSite } from "@/content/site";
import { absoluteUrl, CANONICAL_ORIGIN, socialMeta } from "@/lib/seo";

export const Route = createFileRoute("/")({
  loader: () => getHome(),
  head: ({ loaderData }) => {
    const origin = loaderData?.origin || CANONICAL_ORIGIN;
    const url = absoluteUrl(origin, "/");
    const current = loaderData?.site ?? fallbackSite;
    const title = "DYPOL BLOG";
    return {
      meta: [
        { title },
        { name: "description", content: current.description },
        ...socialMeta({ title, description: current.description, url, type: "website", siteName: "DYPOL BLOG", image: absoluteUrl(origin, "/og.jpg") }),
      ],
      links: [
        { rel: "canonical", href: url },
        // t88: preload the featured cover - it is the homepage LCP element.
        ...(() => {
          const lead = loaderData?.blocks?.find((b) => b.block.type === "featured")?.cards[0];
          return lead?.coverMediaId
            ? [{ rel: "preload", as: "image", href: `/media/${lead.coverMediaId}`, fetchPriority: "high" } as const]
            : [];
        })(),
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "DYPOL BLOG",
            alternateName: [new URL(origin).host, "DYPOL"],
            url,
          }),
        },
      ],
    };
  },
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
          <h1 className="page-title">DYPOL BLOG</h1>
          <p className="lede">{site.labels.emptyBody}</p>
        </div>
      </div>
    );
  }
  return <HomeBlocks blocks={blocks} site={site} />;
}
