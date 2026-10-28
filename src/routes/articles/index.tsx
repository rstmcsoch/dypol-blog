import { createFileRoute, notFound } from "@tanstack/react-router";
import { IndexList } from "@/components/site/index-list";
import { NotFoundState, PagePending } from "@/components/site/states";
import { Pager, pageHref, parsePage } from "@/components/site/pager";
import { useSite } from "@/components/site/use-site";
import { getIndex } from "@/content/public-api";
import { defaultOgPath, absoluteUrl, itemListJsonLd, sitePageTitle, socialMeta } from "@/lib/seo";

export const Route = createFileRoute("/articles/")({
  validateSearch: (search: Record<string, unknown>): { page?: number } => {
    const page = parsePage(search.page);
    return page === undefined || page === 1 ? {} : { page };
  },
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  loader: async ({ deps }) => {
    const data = await getIndex({ data: { page: deps.page } });
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: sitePageTitle("Not found") }, { name: "robots", content: "noindex" }] };
    const origin = loaderData.origin ?? "";
    const page = loaderData.page ?? 1;
    const pages = loaderData.pages ?? 1;
    const path = pageHref("/articles", page);
    const title = sitePageTitle(page > 1 ? `${loaderData.site.labels.indexTitle} — Page ${page}` : loaderData.site.labels.indexTitle, loaderData.site.name);
    const description = loaderData.site.labels.indexLede;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...socialMeta({ title, description, url: absoluteUrl(origin, path), type: "website", siteName: loaderData?.site.name, image: absoluteUrl(origin, defaultOgPath(loaderData?.site ?? {})) }),
      ],
      links: [
        { rel: "canonical", href: absoluteUrl(origin, path) },
        ...(page > 1 ? [{ rel: "prev", href: absoluteUrl(origin, pageHref("/articles", page - 1)) }] : []),
        ...(page < pages ? [{ rel: "next", href: absoluteUrl(origin, pageHref("/articles", page + 1)) }] : []),
      ],
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
  notFoundComponent: NotFoundState,
  component: ArticlesPage,
});

function ArticlesPage() {
  const site = useSite();
  const { articles, meta, page, pages, start } = Route.useLoaderData();
  return (
    <div className="page">
      <div className="container">
        <header className="page-header">
          <p className="kicker">{site.labels.indexKicker}</p>
          <h1 className="page-title">{site.labels.indexTitle}</h1>
          <p className="lede">{site.labels.indexLede}</p>
        </header>
        <IndexList articles={articles} meta={meta} minRead={site.labels.minRead} start={start} />
        <Pager basePath="/articles" page={page} pages={pages} />
      </div>
    </div>
  );
}