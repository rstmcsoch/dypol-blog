import { createFileRoute } from "@tanstack/react-router";
import { HomeBlocks } from "@/components/site/blocks";
import { PagePending } from "@/components/site/states";
import { useSite } from "@/components/site/use-site";
import { getHome } from "@/content/public-api";
import { site as fallbackSite } from "@/content/site";
import { absoluteUrl, socialMeta, websiteJsonLd } from "@/lib/seo";

export const Route = createFileRoute("/")({
  loader: () => getHome(),
  head: ({ loaderData }) => {
    const origin = loaderData?.origin ?? "";
    const url = absoluteUrl(origin, "/");
    return {
      meta: [
        { title: fallbackSite.title },
        { name: "description", content: fallbackSite.description },
        ...socialMeta({ title: fallbackSite.title, description: fallbackSite.description, url, type: "website", siteName: fallbackSite.name, image: absoluteUrl(origin, "/og.jpg") }),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(
            websiteJsonLd({ origin, siteName: fallbackSite.name, title: fallbackSite.title, description: fallbackSite.description, publisher: fallbackSite.publisher }),
          ),
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
  return <HomeBlocks blocks={blocks} site={site} />;
}
