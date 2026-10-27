import { createFileRoute } from "@tanstack/react-router";
import { PagePending } from "@/components/site/states";
import { TopicGrid } from "@/components/site/topic-grid";
import { useSite } from "@/components/site/use-site";
import { getTopics } from "@/content/public-api";
import { absoluteUrl, itemListJsonLd, sitePageTitle, socialMeta } from "@/lib/seo";

export const Route = createFileRoute("/topics/")({
  loader: () => getTopics(),
  head: ({ loaderData }) => {
    const origin = loaderData?.origin ?? "";
    const title = sitePageTitle("Topics");
    const description = "Pieces are filed by subject: AI, smartphones, cybersecurity, startups, product reviews, tech news and more.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...socialMeta({ title, description, url: absoluteUrl(origin, "/topics"), type: "website", siteName: "DYPOL BLOG", image: absoluteUrl(origin, "/og.jpg") }),
      ],
      links: [{ rel: "canonical", href: absoluteUrl(origin, "/topics") }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(
            itemListJsonLd({ origin, items: (loaderData?.topics ?? []).map((t) => ({ name: t.category.label, path: `/topics/${t.category.slug}` })) }),
          ),
        },
      ],
    };
  },
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