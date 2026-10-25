import { createFileRoute, Link } from "@tanstack/react-router";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { adminArticleStats } from "@/content/admin-api";
import { formatCount, formatDuration, formatPercent, kolkataDisplayDate } from "@/lib/analytics-dates";
import { niceMax, shortDate } from "@/lib/analytics-metrics";

type Search = { preset?: string; from?: string; to?: string };

export const Route = createFileRoute("/admin/stats_/article/$id")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    preset: typeof search.preset === "string" ? search.preset : undefined,
    from: typeof search.from === "string" ? search.from : undefined,
    to: typeof search.to === "string" ? search.to : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, params, deps }) => {
    const desk = (context as { desk?: { session: unknown } }).desk;
    if (!desk?.session) return { data: null, error: "not-signed-in" as string | null };
    try {
      return { data: await adminArticleStats({ data: { id: params.id, ...deps } }), error: null as string | null };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : "Failed to load article stats." };
    }
  },
  component: ArticleStatsPage,
});

function Card({ title, value, help }: { title: string; value: string; help?: string }) {
  return (
    <div className="adm-stat-card" title={help}>
      <p className="adm-stat__kicker">{title}</p>
      <div className="adm-stat__value">{value}</div>
    </div>
  );
}

function ArticleStatsPage() {
  const { data, error } = Route.useLoaderData();
  if (error === "not-signed-in") return null;
  if (!data) return <div className="adm-banner adm-banner--bad" role="alert">{error ?? "Article not found."}</div>;
  const d = data;
  const max = niceMax(d.series.map((p) => p.views));
  const series = d.series.map((p) => ({ ...p, label: shortDate(p.date) }));
  return (
    <div className="adm-stats-page">
      <div className="adm-stats__header">
        <div className="adm-article-head">
          <p className="desk-kicker"><Link to="/admin/stats">← Stats</Link> · Article drill-down</p>
          <h1 className="desk-title">{d.article.title}</h1>
          <p className="desk-note">
            {d.article.categoryLabel}
            {d.article.publishedAt ? ` · published ${kolkataDisplayDate(d.article.publishedAt)}` : ""} · {d.period.label} ·{" "}
            <Link to="/admin/articles/$id" params={{ id: d.article.id }}>Edit article</Link> ·{" "}
            <a href={`/articles/${d.article.slug}`} target="_blank" rel="noreferrer">View live</a>
          </p>
        </div>
      </div>
      <div className="stat-grid adm-stat-grid">
        <Card title="Views (period)" value={formatCount(d.viewsInPeriod)} />
        <Card title="Views since publish" value={formatCount(d.viewsSincePublish)} help="Beacon-measured views since publication (or since measurement started)." />
        <Card title="First 24h" value={formatCount(d.first24h)} />
        <Card title="First 7 days" value={formatCount(d.first7d)} />
        <Card title="Sessions" value={formatCount(d.sessions)} />
        <Card title="Avg engaged time" value={d.avgEngagedTime == null ? "—" : formatDuration(d.avgEngagedTime)} help="Engaged time ÷ page views." />
        <Card title="Completion" value={formatPercent(d.completionRate)} help="Reached ~90% scroll with ≥15s engaged." />
        <Card title="Raw hits (all-time)" value={formatCount(d.rawHits)} help="Cumulative server counter, includes bots." />
      </div>
      <section className="adm-section adm-section--two-col">
        <div className="adm-panel">
          <div className="adm-chart-wrap">
            <div className="adm-chart__label">Daily views since publish</div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={series} margin={{ top: 10, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} interval={Math.max(0, Math.ceil(series.length / 7) - 1)} />
                <YAxis domain={[0, max]} allowDecimals={false} tick={{ fontSize: 11, fill: "#6b7280" }} width={36} />
                <Tooltip />
                <Bar dataKey="views" name="Views" fill="#2f5bea" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="adm-panel adm-panel__body">
          <h3 className="adm-card-title">Scroll-depth funnel</h3>
          {d.funnel.every((f) => f.reads === 0) ? (
            <p className="adm-empty__body adm-left">No scroll data yet for this period.</p>
          ) : (
            <ul className="adm-funnel">
              {d.funnel.map((f) => (
                <li key={f.depth}>
                  <span className="adm-funnel__label">{f.depth}%</span>
                  <span className="adm-funnel__track"><span style={{ width: `${f.share ?? 0}%` }} /></span>
                  <span className="adm-funnel__val">{formatPercent(f.share)} <small>({formatCount(f.reads)})</small></span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="adm-panel adm-panel__body">
          <h3 className="adm-card-title">Traffic sources</h3>
          {d.sources.length === 0 ? (
            <p className="adm-empty__body adm-left">No source data yet for this period.</p>
          ) : (
            <table className="adm-table--compact">
              <thead><tr><th>Source</th><th className="text-right">Sessions</th></tr></thead>
              <tbody>{d.sources.map((s) => <tr key={s.source}><td>{s.source}</td><td className="text-right">{formatCount(s.sessions)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div className="adm-panel adm-panel__body">
          <h3 className="adm-card-title">Next pages (internal clicks)</h3>
          {d.nextPages.length === 0 ? (
            <p className="adm-empty__body adm-left">No internal article clicks from this article yet.</p>
          ) : (
            <table className="adm-table--compact">
              <thead><tr><th>Article</th><th className="text-right">Clicks</th></tr></thead>
              <tbody>
                {d.nextPages.map((n) => (
                  <tr key={n.id}>
                    <td><Link to="/admin/stats/article/$id" params={{ id: n.id }}>{n.title}</Link></td>
                    <td className="text-right">{formatCount(n.clicks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
