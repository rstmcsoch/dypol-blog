import { createFileRoute } from "@tanstack/react-router";
import { HomeBlocks } from "@/components/site/blocks";
import { AdPage } from "@/components/site/ads";

const HOME_PAGE = { type: "home" as const };
import { PagePending } from "@/components/site/states";
import { useSite } from "@/components/site/use-site";
import { getHome } from "@/content/public-api";
import { site as fallbackSite } from "@/content/site";
import { defaultOgPath, absoluteUrl, CANONICAL_ORIGIN, socialMeta } from "@/lib/seo";

export const Route = createFileRoute("/")({
  loader: () => getHome(),
  head: ({ loaderData }) => {
    const origin = loaderData?.origin || CANONICAL_ORIGIN;
    const url = absoluteUrl(origin, "/");
    const current = loaderData?.site ?? fallbackSite;
    const title = current.title;
    return {
      meta: [
        { title },
        { name: "description", content: current.description },
        ...socialMeta({ title, description: current.description, url, type: "website", siteName: current.name, image: absoluteUrl(origin, defaultOgPath(current)) }),
      ],
      links: [
        { rel: "canonical", href: url },
        // t147: no manual hero preload: React 19 already hoists one for the
        // eager fetchPriority=high cover <img> (a second copy was a duplicate).
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: current.name,
            alternateName: [new URL(origin).host],
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
          <h1 className="page-title">{site.name}</h1>
          <p className="lede">{site.labels.emptyBody}</p>
        </div>
      </div>
    );
  }
  return (
    <AdPage page={HOME_PAGE}>
      <HomeBlocks blocks={blocks} site={site} />
    </AdPage>
  );
}
