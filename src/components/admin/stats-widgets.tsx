import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { rate } from "@/lib/stats/aggregate";
import { formatCount, formatDelta, formatDuration, formatPercent, toCsv } from "@/lib/stats/format";
import type { AgeFilter, ArticleQuery, ArticleSort, ArticleStat, StatsPayload } from "@/lib/stats/types";

const HBarChart = lazy(() => import("./stats-charts").then((m) => ({ default: m.HBarChart })));

const SORTS: { id: ArticleSort; label: string }[] = [
  { id: "views", label: "Most viewed" },
  { id: "engagement", label: "Highest engagement rate" },
  { id: "reading", label: "Highest average reading time" },
  { id: "completion", label: "Highest completion" },
  { id: "growth", label: "Fastest growth" },
  { id: "declining", label: "Declining traffic" },
  { id: "newest", label: "Newly published" },
  { id: "recirc", label: "Most extra article clicks" },
];

const PAGE_SIZE = 20;

export function WhenMounted({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;
  return <Suspense fallback={null}>{children}</Suspense>;
}

export function Kpi({ label, hint, value, delta }: { label: string; hint: string; value: string; delta: { text: string; tone: "up" | "down" | "flat" | "new" } | null }) {
  return (
    <p className="stat">
      <strong>{value}</strong>
      <span>
        {label} <button type="button" className="stats-hint" title={hint} aria-label={hint}>i</button>
      </span>
      {delta ? <em className={`delta delta--${delta.tone}`}>{delta.text}{delta.tone === "new" ? "" : " vs previous"}</em> : null}
    </p>
  );
}

export function ChartCard({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="stats-card">
      <h2>{title}</h2>
      <p>{note}</p>
      <div className="stats-plot" role="img" aria-label={`${title}. ${note}`}>
        <WhenMounted>{children}</WhenMounted>
      </div>
    </section>
  );
}

export function DataTable({ title, note, headers, rows }: { title: string; note?: string; headers: string[]; rows: string[][] }) {
  return (
    <section className="desk-section">
      <h2>{title}</h2>
      {note ? <p className="desk-note">{note}</p> : null}
      {rows.length === 0 ? <p className="stats-empty">No rows for this period.</p> : (
        <div className="desk-table-wrap">
          <table className="desk-table">
            <thead><tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${title}-${index}`}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function Unavailable({ items }: { items: [string, string][] }) {
  return (
    <ul className="stats-missing">
      {items.map(([title, detail]) => (
        <li key={title}><strong>{title}</strong><span>{detail}</span></li>
      ))}
    </ul>
  );
}

export function ArticleBars({ title, note, rows, unit }: { title: string; note: string; rows: { name: string; value: number }[]; unit: string }) {
  return (
    <div className="stats-charts">
      <ChartCard title={title} note={note}>
        <HBarChart name={unit} data={rows} />
      </ChartCard>
    </div>
  );
}

export function topReading(articles: ArticleStat[]) {
  return articles
    .filter((article) => article.engagedViews >= 5)
    .map((article) => ({ name: short(article.title), value: Math.round(article.engagedMs / article.engagedViews / 1000) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

export function weakReading(articles: ArticleStat[], siteRate: number | null) {
  if (siteRate == null) return [];
  return articles
    .filter((article) => article.views >= 15 && article.engagedViews / article.views <= siteRate * 0.6)
    .map((article) => ({ name: short(article.title), value: Math.round((article.engagedViews / article.views) * 100) }))
    .sort((a, b) => a.value - b.value)
    .slice(0, 8);
}

export function short(value: string) {
  return value.length > 28 ? `${value.slice(0, 26)}…` : value;
}

export function publishBars(articles: ArticleStat[], payload: StatsPayload) {
  const counts = new Map<string, number>();
  for (const article of articles) {
    if (!article.publishedDay || article.publishedDay < payload.range.from || article.publishedDay > payload.range.to) continue;
    const key = payload.range.grain === "month" ? article.publishedDay.slice(0, 7) : article.publishedDay;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([name, value]) => ({ name: name.slice(5) || name, value }));
}

export function ArticleTable({
  articles,
  query,
  setQuery,
  page,
  setPage,
  categories,
  tags,
  compare,
  range,
}: {
  articles: ArticleStat[];
  query: ArticleQuery;
  setQuery: (value: ArticleQuery) => void;
  page: number;
  setPage: (value: number) => void;
  categories: { slug: string; label: string }[];
  tags: { slug: string; label: string }[];
  compare: boolean;
  range: StatsPayload["range"];
}) {
  const pages = Math.max(1, Math.ceil(articles.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const slice = articles.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const exportCsv = () => {
    const headers = ["Title", "Slug", "Topic", "Tags", "Published", "Age days", "Views", "Previous views", "Recorded reads", "Avg recorded seconds", "Engagement rate", "End rate", "Internal clicks", "Recirculation rate", "Search clicks", "Search impressions", "Search CTR", "Avg position"];
    const rows = articles.map((article) => {
      const age = article.publishedDay ? Math.max(0, Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${article.publishedDay}T00:00:00Z`)) / 86_400_000)) : "";
      return [
        article.title,
        article.slug,
        article.topics.map((topic) => topic.label).join("; "),
        article.tags.map((tag) => tag.label).join("; "),
        article.publishedDay ?? "",
        age,
        article.views,
        article.prevViews,
        article.engagedViews,
        article.engagedViews > 0 ? Math.round(article.engagedMs / article.engagedViews / 1000) : "",
        article.views > 0 ? (article.engagedViews / article.views).toFixed(4) : "",
        article.views > 0 ? (article.scrollEnd / article.views).toFixed(4) : "",
        article.internalClicks,
        article.views > 0 ? (article.recircViews / article.views).toFixed(4) : "",
        "",
        "",
        "",
        "",
      ];
    });
    const csv = toCsv(headers, rows);
    const blob = new Blob([`${csv}\n# Search columns are blank because Search Console is not connected.\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dypol-stats-${range.from}-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ range, articles }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dypol-stats-${range.from}-${range.to}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="desk-section" role="tabpanel">
      <div className="filters">
        <label className="field"><span>Search</span><input value={query.q} placeholder="Title or slug" onChange={(event) => { setQuery({ ...query, q: event.target.value }); setPage(0); }} /></label>
        <label className="field"><span>Topic</span>
          <select value={query.category} onChange={(event) => { setQuery({ ...query, category: event.target.value }); setPage(0); }}>
            <option value="">All topics</option>
            {categories.map((category) => <option key={category.slug} value={category.slug}>{category.label}</option>)}
          </select>
        </label>
        <label className="field"><span>Tag</span>
          <select value={query.tag} onChange={(event) => { setQuery({ ...query, tag: event.target.value }); setPage(0); }}>
            <option value="">All tags</option>
            {tags.map((tag) => <option key={tag.slug} value={tag.slug}>{tag.label}</option>)}
          </select>
        </label>
        <label className="field"><span>Age</span>
          <select value={query.age} onChange={(event) => { setQuery({ ...query, age: event.target.value as AgeFilter }); setPage(0); }}>
            <option value="any">Any age</option>
            <option value="7">Published in 7 days</option>
            <option value="28">Published in 28 days</option>
            <option value="90">Published in 90 days</option>
            <option value="older90">Older than 90 days</option>
          </select>
        </label>
        <label className="field"><span>Sort</span>
          <select value={query.sort} onChange={(event) => { setQuery({ ...query, sort: event.target.value as ArticleSort }); setPage(0); }}>
            {SORTS.map((sort) => <option key={sort.id} value={sort.id}>{sort.label}</option>)}
          </select>
        </label>
      </div>
      <p className="desk-note">Search clicks and impressions are not columns with numbers: Search Console is not connected. {articles.length.toLocaleString("en-IN")} articles match.</p>
      <p className="adm-row-actions">
        <button type="button" className="btn" onClick={exportCsv}>Export CSV</button>
        <button type="button" className="btn btn--ghost" onClick={exportJson}>Export JSON</button>
      </p>
      <div className="desk-table-wrap">
        <table className="desk-table">
          <thead>
            <tr>
              <th scope="col">Article</th>
              <th scope="col">Published</th>
              <th scope="col">Views</th>
              {compare ? <th scope="col">Vs previous</th> : null}
              <th scope="col">Avg time</th>
              <th scope="col">Engagement</th>
              <th scope="col">End</th>
              <th scope="col">Onward clicks</th>
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? <tr><td colSpan={compare ? 8 : 7}>No articles match these filters.</td></tr> : slice.map((article) => {
              const delta = formatDelta(article.views, article.prevViews);
              return (
                <tr key={article.id}>
                  <td>
                    <Link to="/admin/articles/$id" params={{ id: article.id }}>{article.title}</Link>
                    <small className="stats-sub">{article.categoryLabel || "No topic"}{article.tags.length ? ` · ${article.tags.map((tag) => tag.label).join(", ")}` : ""} · <a href={`/articles/${article.slug}`} target="_blank" rel="noreferrer">View</a></small>
                  </td>
                  <td>{article.publishedDay ?? "—"}</td>
                  <td>{formatCount(article.views)}</td>
                  {compare ? <td className={`delta delta--${delta.tone}`}>{delta.text}</td> : null}
                  <td>{formatDuration(article.engagedViews > 0 ? article.engagedMs / article.engagedViews : null)}</td>
                  <td>{formatPercent(rate(article.engagedViews, article.views))}</td>
                  <td>{formatPercent(rate(article.scrollEnd, article.views))}</td>
                  <td>{formatCount(article.internalClicks)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="adm-row-actions">
        <button type="button" className="btn btn--ghost" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Previous</button>
        <span className="desk-note">Page {safePage + 1} of {pages}</span>
        <button type="button" className="btn btn--ghost" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)}>Next</button>
      </p>
    </section>
  );
}

export function Methodology() {
  return (
    <details className="stats-method">
      <summary>How these figures are calculated</summary>
      <ul>
        <li>Article view: one count per browser tab session per article, for a published article. Refreshes in the same tab are not counted again. This matches the counter the site already had, and it is not a GA4 page view.</li>
        <li>Other page view: the same once-per-tab rule for home, topics and other public pages. The path is checked, then thrown away.</li>
        <li>Recorded read: a single beacon when the page hides, with time the tab was visible (paused while hidden, capped at 20 minutes), the furthest scroll, and clicks to other articles.</li>
        <li>Engagement rate = recorded reads ÷ article views. Average time per view treats a missing beacon as zero. Average time per recorded read ignores missing beacons. The median uses only the histogram of beacons.</li>
        <li>End of article = beacon reported at least 90% scroll, or the end-of-article marker was visible.</li>
        <li>Recirculation rate = views with at least one onward article click ÷ article views. Click totals are not readers.</li>
        <li>Dates are civil dates in Asia/Kolkata. Weeks in long ranges are 7-day chunks from the first day, not calendar weeks.</li>
        <li>Lifetime views are the old undated counter. They are labeled separately and are never presented as this period’s traffic.</li>
        <li>No IP, raw user-agent, full referrer URL, visitor id or per-visit row is stored.</li>
      </ul>
    </details>
  );
}
