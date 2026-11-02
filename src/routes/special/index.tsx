import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AdPage, AdSlot } from "@/components/site/ads";
import { NotFoundState, PagePending } from "@/components/site/states";
import { Pager, parsePage } from "@/components/site/pager";
import { SpecialCards } from "@/components/site/special-view";
import { getSpecialArchive } from "@/content/public-api";
import { defaultOgPath, absoluteUrl, itemListJsonLd, sitePageTitle, socialMeta } from "@/lib/seo";

const ARCHIVE_PAGE = { type: "index" as const };

export const Route = createFileRoute("/special/")({
  validateSearch: (search: Record<string, unknown>): { page?: number; topic?: string } => {
    const page = parsePage(search.page);
    const topic = typeof search.topic === "string" && /^[a-z0-9-]{1,80}$/.test(search.topic) ? search.topic : undefined;
    return { ...(page && page > 1 ? { page } : {}), ...(topic ? { topic } : {}) };
  },
  loaderDeps: ({ search }) => ({ page: search.page ?? 1, topic: search.topic }),
  loader: async ({ deps }) => {
    const data = await getSpecialArchive({ data: { page: deps.page, topic: deps.topic } });
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: sitePageTitle("Not found") }, { name: "robots", content: "noindex" }] };
    const origin = loaderData.origin ?? "";
    const base = loaderData.topic ? `/special?topic=${loaderData.topic.slug}` : "/special";
    const path = loaderData.page > 1 ? `${base}${base.includes("?") ? "&" : "?"}page=${loaderData.page}` : base;
    const title = sitePageTitle(`Special reports${loaderData.topic ? ` — ${loaderData.topic.label}` : ""}${loaderData.page > 1 ? ` — Page ${loaderData.page}` : ""}`, loaderData.site.name);
    const description = "In-depth, sourced long reads from DYPOL: research, data and documents in one place.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...(loaderData.total === 0 ? [{ name: "robots", content: "noindex" }] : []),
        ...socialMeta({ title, description, url: absoluteUrl(origin, path), type: "website", siteName: loaderData.site.name, image: absoluteUrl(origin, defaultOgPath(loaderData.site)) }),
      ],
      links: [{ rel: "canonical", href: absoluteUrl(origin, path) }],
      scripts: [
        { type: "application/ld+json", children: JSON.stringify(itemListJsonLd({ origin, items: loaderData.articles.map((a) => ({ name: a.title, path: `/special/${a.slug}` })) })) },
      ],
    };
  },
  pendingComponent: PagePending,
  notFoundComponent: NotFoundState,
  component: SpecialArchive,
});

function SpecialArchive() {
  const { articles, page, pages, topics, topic, total } = Route.useLoaderData();
  return (
    <AdPage page={ARCHIVE_PAGE}>
      <div className="page spx-archive">
        <div className="container">
          <header className="page-header spx-archive__head">
            <p className="kicker">Special reports</p>
            <h1 className="page-title">{topic ? topic.label : "Special reports"}</h1>
            <p className="lede">In-depth, sourced long reads: research, data and documents in one place.</p>
          </header>
          {topics.length > 1 ? (
            <nav className="spx-filter" aria-label="Filter by topic">
              <Link to="/special" className={!topic ? "topic-chip is-active" : "topic-chip"}>All</Link>
              {topics.map((t) => (
                <Link key={t.id} to="/special" search={{ topic: t.slug }} className={topic?.id === t.id ? "topic-chip is-active" : "topic-chip"}>
                  {t.label} <span className="spx-filter__n">{t.count}</span>
                </Link>
              ))}
            </nav>
          ) : null}
          {total === 0 ? <p className="spx-empty">No special reports yet. Check back soon.</p> : <SpecialCards articles={articles} />}
          <AdSlot id="L1" />
          <Pager basePath={topic ? `/special?topic=${topic.slug}` : "/special"} page={page} pages={pages} />
        </div>
      </div>
    </AdPage>
  );
}


