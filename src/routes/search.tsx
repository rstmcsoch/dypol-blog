import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { trackSearch } from "@/lib/analytics-beacon";
import { PagePending } from "@/components/site/states";
import { useSite } from "@/components/site/use-site";
import { getSearch } from "@/content/public-api";
import { formatDate } from "@/lib/format";
import { thumbUrl } from "@/lib/media-url";
import { sitePageTitle } from "@/lib/seo";

/** Renders an FTS snippet: \u0001…\u0002 marks a hit; everything else is plain (escaped) text. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0001[^\u0002]*\u0002)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("\u0001") ? <mark key={i}>{part.slice(1, -1)}</mark> : <span key={i}>{part.replace(/[\u0001\u0002]/g, "")}</span>,
      )}
    </>
  );
}

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>): { q?: string } => {
    const q = typeof search.q === "string" ? search.q.slice(0, 120) : typeof search.q === "number" ? String(search.q) : "";
    return q.trim() ? { q } : {};
  },
  loaderDeps: ({ search }) => ({ q: search.q ?? "" }),
  loader: async ({ deps }) => (deps.q.trim() ? getSearch({ data: { q: deps.q } }) : { query: "", error: false, results: [] }),
  head: ({ loaderData }) => ({
    meta: [
      { title: sitePageTitle(loaderData?.query ? `Search: ${loaderData.query}` : "Search") },
      { name: "robots", content: "noindex, follow" },
    ],
  }),
  pendingComponent: PagePending,
  component: SearchPage,
});

function SearchPage() {
  const site = useSite();
  const { query, results, error } = Route.useLoaderData();
  useEffect(() => {
    if (query && !error) trackSearch(query, results.length);
  }, [query, error, results.length]);
  return (
    <div className="page search-page">
      <div className="container">
        <header className="page-header">
          <p className="kicker">Search</p>
          <h1 className="page-title">{query ? <>Results for “{query}”</> : "Search the journal"}</h1>
        </header>
        <form className="search-form" action="/search" method="get" role="search">
          <label htmlFor="search-q" className="sr-only">Search stories</label>
          <input id="search-q" name="q" type="search" defaultValue={query} placeholder="Search stories…" autoComplete="off" required maxLength={120} />
          <button type="submit" className="btn btn--accent grain">Search</button>
        </form>
        {error ? <p className="search-page__status" role="status">Search is unavailable right now. Please try again shortly.</p> : null}
        {query && !error ? (
          <p className="search-page__status" role="status">
            {results.length === 0 ? "No stories match that search. Try fewer or different words." : `${results.length}${results.length >= 30 ? "+" : ""} ${results.length === 1 ? "story" : "stories"} found`}
          </p>
        ) : null}
        {results.length > 0 ? (
          <ol className="index-list search-results">
            {results.map((r, i) => (
              <li key={r.id}>
                <Link to="/articles/$slug" params={{ slug: r.slug }} className="index-row">
                  <span className="index-row__num">{String(i + 1).padStart(2, "0")}</span>
                  {r.coverMediaId ? (
                    <span className="index-row__thumb"><img src={thumbUrl(r.coverMediaId, r.coverImage?.v)} alt={r.coverAlt?.trim() ? r.coverAlt : r.title} loading="lazy" decoding="async" width={480} height={360} /></span>
                  ) : (
                    <span className="index-row__thumb index-row__thumb--empty" aria-hidden="true">{r.topics[0] ?? ""}</span>
                  )}
                  <span className="index-row__main">
                    <span className="index-row__title">{r.title}</span>
                    <span className="index-row__excerpt search-results__snippet"><Snippet text={r.snippet} /></span>
                  </span>
                  <span className="index-row__meta">
                    {r.topics.length ? <span>{r.topics.slice(0, 2).join(" · ")}</span> : null}
                    {r.publishedAt ? <span>{formatDate(r.publishedAt)}</span> : null}
                    <span>{r.minutes} {site.labels.minRead}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
