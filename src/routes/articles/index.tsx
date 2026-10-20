import { createFileRoute } from "@tanstack/react-router";
import { IndexList } from "@/components/site/index-list";
import { PagePending } from "@/components/site/states";
import { useSite } from "@/components/site/use-site";
import { getIndex } from "@/content/public-api";
import { absoluteUrl, itemListJsonLd, sitePageTitle, socialMeta } from "@/lib/seo";

export const Route = createFileRoute("/articles/")({
  loader: () => getIndex(),
  head: ({ loaderData }) => {
    const origin = loaderData?.origin ?? "";
    const title = sitePageTitle("Index");
    const description = "Every published DYPOL Blog piece, newest first — tech news, reviews and explainers across AI, smartphones, cybersecurity, startups and more.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...socialMeta({ title, description, url: absoluteUrl(origin, "/articles"), type: "website", siteName: "DYPOL Blog", image: absoluteUrl(origin, "/og.jpg") }),
      ],
      links: [{ rel: "canonical", href: absoluteUrl(origin, "/articles") }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(
            itemListJsonLd({ origin, items: (loaderData?.articles ?? []).map((a) => ({ name: a.title, path: `/articles/${a.slug}` })) }),
          ),
        },
      ],
    };
  },
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