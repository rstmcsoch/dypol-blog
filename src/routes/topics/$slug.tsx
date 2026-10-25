import { createFileRoute, notFound } from "@tanstack/react-router";
import { IndexList } from "@/components/site/index-list";
import { EmptyState, NotFoundState, PagePending } from "@/components/site/states";
import { useSite } from "@/components/site/use-site";
import { getTopic } from "@/content/public-api";
import { Pager, pageHref, parsePage } from "@/components/site/pager";
import { absoluteUrl, breadcrumbJsonLd, itemListJsonLd, sitePageTitle, socialMeta, topicMetaDescription } from "@/lib/seo";

export const Route = createFileRoute("/topics/$slug")({
  validateSearch: (search: Record<string, unknown>): { page?: number } => {
    const page = parsePage(search.page);
    return page === undefined || page === 1 ? {} : { page };
  },
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  loader: async ({ params, deps }) => {
    const data = await getTopic({ data: { slug: params.slug, page: deps.page } });
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: sitePageTitle("Not found") }, { name: "robots", content: "noindex" }] };
    const origin = loaderData.origin ?? "";
    const page = loaderData.page ?? 1;
    const pages = loaderData.pages ?? 1;
    const base = `/topics/${loaderData.category.slug}`;
    const title = sitePageTitle(page > 1 ? `${loaderData.category.label} — Page ${page}` : loaderData.category.label);
    const description = topicMetaDescription(loaderData.category.label, loaderData.category.description);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...socialMeta({ title, description, url: absoluteUrl(origin, pageHref(base, page)), type: "website", siteName: "DYPOL Blog", image: absoluteUrl(origin, "/og.jpg") }),
      ],
      links: [
        { rel: "canonical", href: absoluteUrl(origin, pageHref(base, page)) },
        ...(page > 1 ? [{ rel: "prev", href: absoluteUrl(origin, pageHref(base, page - 1)) }] : []),
        ...(page < pages ? [{ rel: "next", href: absoluteUrl(origin, pageHref(base, page + 1)) }] : []),
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(
            breadcrumbJsonLd({ origin, items: [{ name: "Home", path: "/" }, { name: "Topics", path: "/topics" }, { name: loaderData.category.label, path: `/topics/${loaderData.category.slug}` }] }),
          ),
        },
        {
          type: "application/ld+json",
          children: JSON.stringify(
            itemListJsonLd({ origin, items: loaderData.articles.map((a) => ({ name: a.title, path: `/articles/${a.slug}` })) }),
          ),
        },
      ],
    };
  },
  pendingComponent: PagePending,
  notFoundComponent: NotFoundState,
  component: TopicPage,
});

function TopicPage() {
  const site = useSite();
  const { category, articles, meta, page, pages, start } = Route.useLoaderData();
  return (
    <div className="page">
      <div className="container">
        <header className="page-header">
          <p className="kicker">{site.labels.topicsKicker}</p>
          <h1 className="page-title">{category.label}</h1>
          <p className="lede">{category.description}</p>
        </header>
        {articles.length > 0 ? (
          <>
            <IndexList articles={articles} meta={meta} minRead={site.labels.minRead} start={start} />
            <Pager basePath={`/topics/${category.slug}`} page={page} pages={pages} />
          </>
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}