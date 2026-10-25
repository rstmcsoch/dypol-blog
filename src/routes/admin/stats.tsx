import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createFileRoute,
  Link,
  useRouter,
} from "@tanstack/react-router";
import { adminStats, adminStatsAnnotation } from "@/content/admin-api";
import type { TopicRow, SourceRow, DeviceRow } from "@/content/analytics.server";
import {
  formatCount,
  formatDuration,
  formatPercent,
  kolkataDisplayDate,
  type DatePreset,
} from "@/lib/analytics-dates";
import { alignSeries, deltaPercent, insightsAllowed, INSIGHT_MIN_SESSIONS, niceMax, shortDate } from "@/lib/analytics-metrics";
import { HelpCircle, Download, Clock, ArrowUpRight } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
  PieChart,
  Pie,
  ReferenceLine,
} from "recharts";
import { createColumnHelper, getCoreRowModel, useReactTable } from "@tanstack/react-table";

type AdminStats = Awaited<ReturnType<typeof adminStats>>;

type Search = {
  preset?: string;
  from?: string;
  to?: string;
  compare?: string;
  sort?: string;
  categoryId?: string | null;
  tagId?: string | null;
  q?: string | null;
  page?: string;
  pageSize?: string;
  articleId?: string | null;
};

const SORT_KEYS = [
  "title", "categoryLabel", "publishedAt", "ageDays", "views", "allTimeViews", "sessions",
  "avgEngagementTime", "engagementRate", "completionRate", "growth", "internalClicks", "recirculation",
  "first24h", "first7d",
];

export const Route = createFileRoute("/admin/stats")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const presets: DatePreset[] = [
      "today", "yesterday", "last-7", "last-28", "last-30", "last-90", "last-12-months", "custom",
    ];
    const rawPreset = search.preset === "last-30" ? "last-28" : search.preset;
    const preset =
      typeof rawPreset === "string" && presets.includes(rawPreset as DatePreset)
        ? rawPreset
        : undefined;
    // A custom range needs both bounds; otherwise fall back to the default.
    const finalPreset = preset === "custom" && (!search.from || !search.to) ? undefined : (preset as DatePreset);
    return {
      preset: finalPreset,
      from: typeof search.from === "string" ? search.from : undefined,
      to: typeof search.to === "string" ? search.to : undefined,
      compare: search.compare === "1" || search.compare === "true" ? "1" : undefined,
      sort:
        typeof search.sort === "string" && SORT_KEYS.includes(search.sort.replace(/-$/, ""))
          ? search.sort
          : undefined,
      categoryId: typeof search.categoryId === "string" ? search.categoryId : null,
      tagId: typeof search.tagId === "string" ? search.tagId : null,
      q: typeof search.q === "string" ? search.q : null,
      page: typeof search.page === "string" ? search.page : undefined,
      pageSize: typeof search.pageSize === "string" ? search.pageSize : undefined,
      articleId: typeof search.articleId === "string" ? search.articleId : null,
    };
  },
  loader: async ({ context, deps }) => {
    const desk = (context as { desk?: { session: unknown } }).desk;
    if (!desk?.session) return { error: "not-signed-in" as const };
    try {
      return { data: await adminStats({ data: deps as Search }), error: null as string | null };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : "Failed to load stats." };
    }
  },
  component: StatsPage,
});

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

function TrendIcon({ trend }: { trend: "up" | "down" | "neutral" | null }) {
  if (trend === "up") return <ArrowUpRight size={13} strokeWidth={2.5} />;
  if (trend === "down") return <ArrowUpRight size={13} strokeWidth={2.5} rotate={180} />;
  return <Minus size={13} strokeWidth={2.5} />;
}

function Minus({ size, strokeWidth }: { size: number; strokeWidth: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function HelpTip({ text }: { text: string }) {
  return (
    <span
      className="adm-tip"
      title={text}
      aria-label={text}
      role="img"
    >
      <HelpCircle size={13} strokeWidth={1.6} />
    </span>
  );
}

function StatCard({
  title,
  value,
  delta,
  deltaLabel,
  note,
  trend,
  help,
  noPrior,
}: {
  noPrior?: boolean;
  title: string;
  value: ReactNode;
  delta?: string | null;
  deltaLabel?: string;
  trend?: "up" | "down" | "neutral" | null;
  note?: string;
  help?: string;
}) {
  return (
    <div className="adm-stat-card">
      <p className="adm-stat__kicker">{title}{help ? <HelpTip text={help} /> : null}</p>
      <div className="adm-stat__value">{value}</div>
      {noPrior ? (
        <p className="adm-stat__delta adm-stat__delta--neutral">No prior data</p>
      ) : delta !== undefined ? (
        <p className={`adm-stat__delta ${trend === "up" ? "adm-stat__delta--up" : trend === "down" ? "adm-stat__delta--down" : "adm-stat__delta--neutral"}`}>
          <TrendIcon trend={trend ?? "neutral"} />
          {delta}
          {deltaLabel ? <span className="adm-stat__delta-label">{deltaLabel}</span> : null}
        </p>
      ) : null}
      {note ? <p className="adm-stat__note">{note}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

type ChartPoint = { name: string; [key: string]: number | string };

function formatter(value: number): string {
  return formatCount(value);
}

const COLORS = ["#2f5bea", "#1f7a4d", "#c53030", "#b5891a", "#5b6b7c", "#7aa2e6"];

type SeriesPoint = { date: string; pageViews: number; sessions: number; engagedSeconds: number };

function TrendTooltip({ active, payload, format }: { active?: boolean; payload?: any[]; format: (v: number) => string }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload as { date: string; current: number; previous: number | null; previousDate: string | null };
  return (
    <div className="adm-tooltip">
      <div className="adm-tooltip__date">{shortDate(p.date)}</div>
      <div className="adm-tooltip__value">This period: {format(p.current)}</div>
      {p.previous !== null && p.previousDate ? (
        <div className="adm-tooltip__date">Previous ({shortDate(p.previousDate)}): {format(p.previous)}</div>
      ) : null}
    </div>
  );
}

function tickInterval(n: number): number {
  return Math.max(0, Math.ceil(n / 7) - 1);
}

function LineTrendChart({
  series,
  previousSeries,
  valueKey,
  label,
  valueFormat = formatter,
  height = 240,
  showPrevious = false,
  area = false,
  annotations = [],
}: {
  annotations?: Array<{ date: string; note: string }>;
  series: SeriesPoint[];
  previousSeries?: SeriesPoint[] | null;
  valueKey: "pageViews" | "sessions" | "engagedSeconds";
  label: string;
  valueFormat?: (v: number) => string;
  height?: number;
  showPrevious?: boolean;
  area?: boolean;
}) {
  const data = useMemo(
    () =>
      alignSeries(
        series.map((p) => ({ date: p.date, value: p[valueKey] })),
        showPrevious && previousSeries ? previousSeries.map((p) => ({ date: p.date, value: p[valueKey] })) : null,
      ),
    [series, previousSeries, valueKey, showPrevious],
  );
  const hasPrev = showPrevious && data.some((d) => (d.previous ?? 0) > 0);
  const max = niceMax(data.flatMap((d) => [d.current, hasPrev ? d.previous ?? 0 : 0]));
  return (
    <div className="adm-chart-wrap">
      <div className="adm-chart__label">{label}</div>
      {showPrevious ? (
        <div className="adm-legend">
          <span><i style={{ background: COLORS[0] }} /> This period</span>
          {hasPrev ? <span><i className="adm-legend__dash" /> Previous period</span> : <span className="adm-legend__muted">Previous period: no prior data</span>}
        </div>
      ) : null}
      <ResponsiveContainer width="100%" height={height}>
        {area ? (
          <AreaChart data={data} margin={{ top: 10, right: 16, bottom: 8, left: 0 }}>
            <defs>
              <linearGradient id={`color-area-${valueKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS[1]} stopOpacity={0.45} />
                <stop offset="95%" stopColor={COLORS[1]} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} tickMargin={6} interval={tickInterval(data.length)} />
            <YAxis domain={[0, max]} allowDecimals={false} tickFormatter={valueFormat} tick={{ fontSize: 11, fill: "#6b7280" }} width={40} />
            <Tooltip content={(props: any) => <TrendTooltip {...props} format={valueFormat} />} />
            <Area type="monotone" dataKey="current" name="This period" stroke={COLORS[1]} strokeWidth={2} fill={`url(#color-area-${valueKey})`} />
          </AreaChart>
        ) : (
          <LineChart data={data} margin={{ top: 10, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} tickMargin={6} interval={tickInterval(data.length)} />
            <YAxis domain={[0, max]} allowDecimals={false} tickFormatter={valueFormat} tick={{ fontSize: 11, fill: "#6b7280" }} width={40} />
            <Tooltip content={(props: any) => <TrendTooltip {...props} format={valueFormat} />} />
            {hasPrev ? (
              <Line type="monotone" dataKey="previous" name="Previous period" stroke="#9ca3af" strokeWidth={2} dot={false} strokeDasharray="4 4" />
            ) : null}
            <Line type="monotone" dataKey="current" name="This period" stroke={COLORS[0]} strokeWidth={2} dot={data.length <= 2} />
            {annotations
              .filter((a) => data.some((d) => d.date === a.date))
              .map((a) => (
                <ReferenceLine key={`${a.date}-${a.note}`} x={shortDate(a.date)} stroke="#b5891a" strokeDasharray="2 3" ifOverflow="extendDomain">
                  <title>{a.note}</title>
                </ReferenceLine>
              ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function ComparisonTable({
  hasPrior,
  rows,
}: {
  hasPrior: boolean;
  rows: Array<{ label: string; current: string; previous: string; change: string }>;
}) {
  return (
    <div className="adm-panel__body">
      <h3 className="adm-card-title">This period vs previous period</h3>
      {!hasPrior ? <p className="adm-empty__body adm-left">No prior data — the previous equivalent period has no measured traffic.</p> : null}
      <table className="adm-table--compact">
        <thead>
          <tr><th>Metric</th><th className="text-right">This period</th><th className="text-right">Previous</th><th className="text-right">Change</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="text-right">{r.current}</td>
              <td className="text-right">{hasPrior ? r.previous : "—"}</td>
              <td className="text-right">{hasPrior ? r.change : "No prior data"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyChart({ label, message }: { label: string; message: string }) {
  return (
    <div className="adm-chart-wrap">
      <div className="adm-chart__label">{label}</div>
      <p className="adm-empty__body adm-chart-empty">{message}</p>
    </div>
  );
}

function DonutChart({
  data,
  label,
  colors = COLORS,
  height = 200,
  emptyMessage = "No data yet for this period.",
}: {
  data: { name: string; value: number }[];
  label: string;
  colors?: string[];
  height?: number;
  emptyMessage?: string;
}) {
  const slices = useMemo(() => data.filter((d) => d.value > 0), [data]);
  const total = slices.reduce((sum, d) => sum + d.value, 0);
  if (slices.length === 0) return <EmptyChart label={label} message={emptyMessage} />;
  return (
    <div className="adm-chart-wrap">
      <div className="adm-chart__label">{label}</div>
      <div className="adm-donut">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Tooltip
              content={({ active, payload }: any) => {
                if (active && payload && payload.length) {
                  const entry = payload[0].payload as { name: string; value: number };
                  return (
                    <div className="adm-tooltip">
                      <div className="adm-tooltip__date">{entry.name}</div>
                      <div className="adm-tooltip__value">{formatCount(entry.value)} ({((entry.value / total) * 100).toFixed(1)}%)</div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Pie dataKey="value" nameKey="name" data={slices} cx="50%" cy="50%" innerRadius={50} outerRadius={78} paddingAngle={slices.length > 1 ? 2 : 0} isAnimationActive={false}>
              {slices.map((entry, index) => (
                <Cell key={`cell-${entry.name}`} fill={colors[index % colors.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <ul className="adm-donut__legend">
          {slices.map((d, i) => (
            <li key={d.name} title={d.name}>
              <i style={{ background: colors[i % colors.length] }} />
              <span className="adm-donut__name">{d.name}</span>
              <span className="adm-donut__pct">{((d.value / total) * 100).toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TruncTick({ x, y, payload }: any) {
  const full = String(payload?.value ?? "");
  const short = full.length > 20 ? `${full.slice(0, 19)}…` : full;
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{full}</title>
      <text x={-6} y={0} dy={4} textAnchor="end" fontSize={12} fill="#1d2330">{short}</text>
    </g>
  );
}

function HorizontalBarChart({
  data,
  label,
  emptyMessage = "No data yet for this period.",
}: {
  data: { name: string; value: number }[];
  label: string;
  emptyMessage?: string;
}) {
  const sorted = useMemo(() => [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value), [data]);
  if (sorted.length === 0) return <EmptyChart label={label} message={emptyMessage} />;
  const height = Math.max(160, sorted.length * 34 + 40);
  return (
    <div className="adm-chart-wrap">
      <div className="adm-chart__label">{label}</div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={sorted} margin={{ top: 8, right: 24, bottom: 8, left: 8 }} layout="vertical" barCategoryGap={8}>
          <XAxis type="number" domain={[0, niceMax(sorted.map((d) => d.value))]} allowDecimals={false} tickFormatter={formatter} tick={{ fontSize: 11, fill: "#6b7280" }} />
          <YAxis dataKey="name" type="category" width={150} tick={<TruncTick />} interval={0} />
          <Tooltip cursor={{ fill: "rgba(47,91,234,0.06)" }} formatter={(v: number) => formatCount(v)} />
          <Bar dataKey="value" name={label} fill="#2f5bea" radius={[0, 6, 6, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function HistogramChart({
  buckets,
}: {
  buckets: { label: string; count: number }[];
}) {
  const max = useMemo(() => Math.max(1, ...buckets.map((b) => b.count)), [buckets]);
  return (
    <div className="adm-chart-wrap">
      <div className="adm-chart__label">Reading-time distribution (histogram)</div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={buckets} margin={{ top: 10, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} />
          <YAxis type="number" domain={[0, max]} tickFormatter={formatter} tick={{ fontSize: 11, fill: "#6b7280" }} width={36} />
          <Tooltip cursor={{ fill: "transparent" }} />
          <Bar dataKey="count" name="Reads" fill="#2f5bea" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

type LeaderboardRow = AdminStats["leaderboard"]["rows"][number];

const columnHelper = createColumnHelper<LeaderboardRow>();

function Abbr({ short, full }: { short: string; full: string }) {
  return <abbr title={full}>{short}</abbr>;
}

const columns = [
  columnHelper.accessor("title", {
    header: () => "Article",
    cell: (info) => {
      const row = info.row.original;
      return (
        <Link to="/admin/stats/article/$id" params={{ id: row.id }} title="Open article stats">
          {row.title}
        </Link>
      );
    },
  }),
  columnHelper.accessor("categoryLabel", { header: () => "Category", cell: (info) => info.getValue() || "—" }),
  columnHelper.accessor("tagLabels", { header: () => <Abbr short="Tags" full="Topics the article is filed under" />, cell: (info) => info.getValue().join(", ") || "—" }),
  columnHelper.accessor("publishedAt", {
    header: () => "Published",
    cell: (info) => {
      const published = info.getValue();
      return published ? kolkataDisplayDate(published) : "—";
    },
  }),
  columnHelper.accessor("ageDays", { header: () => <Abbr short="Age" full="Days since publication" />, cell: (info) => info.getValue() ?? "—" }),
  columnHelper.accessor("views", { header: () => <Abbr short="Views" full="Page views in the period (beacon, bots excluded)" />, cell: (info) => formatCount(info.getValue()) }),
  columnHelper.accessor("allTimeViews", { header: () => <Abbr short="Raw hits" full="Raw hits (all-time): cumulative server counter, includes bots and repeat loads" />, cell: (info) => formatCount(info.getValue()) }),
  columnHelper.accessor("sessions", { header: () => <Abbr short="Sess." full="Reading sessions (reader × IST day)" />, cell: (info) => formatCount(info.getValue()) }),
  columnHelper.accessor("avgEngagementTime", { header: () => <Abbr short="Avg eng." full="Average engaged time = engaged time ÷ page views" />, cell: (info) => (info.getValue() == null ? "—" : formatDuration(info.getValue() ?? 0)) }),
  columnHelper.accessor("engagementRate", { header: () => <Abbr short="Eng. %" full="Engagement rate: reads with ≥10s engaged, 2+ views or an internal click" />, cell: (info) => formatPercent(info.getValue()) }),
  columnHelper.accessor("completionRate", { header: () => <Abbr short="Compl. %" full="Read completion: reached ~90% scroll with ≥15s engaged" />, cell: (info) => formatPercent(info.getValue()) }),
  columnHelper.accessor("growth", { header: () => <Abbr short="Growth" full="Page views vs previous equivalent period" />, cell: (info) => info.row.original.growthLabel }),
  columnHelper.accessor("internalClicks", { header: () => <Abbr short="Int. clicks" full="Clicks from this article to another article" />, cell: (info) => formatCount(info.getValue()) }),
  columnHelper.accessor("first24h", { header: () => <Abbr short="1st 24h" full="Views on the publication day and the next IST day (— = published before measurement started)" />, cell: (info) => (info.getValue() == null ? "—" : formatCount(info.getValue() ?? 0)) }),
  columnHelper.accessor("first7d", { header: () => <Abbr short="1st 7d" full="Views in the first 7 IST days after publication (— = published before measurement started)" />, cell: (info) => (info.getValue() == null ? "—" : formatCount(info.getValue() ?? 0)) }),
  columnHelper.accessor("recirculation", { header: () => <Abbr short="Recirc. %" full="Per-article recirculation: share of this article's views followed by a click to another article" />, cell: (info) => formatPercent(info.getValue()) }),
];

const sortableColumnIds = [
  "title", "categoryLabel", "publishedAt", "ageDays", "views", "allTimeViews",
  "sessions", "avgEngagementTime", "engagementRate", "completionRate", "growth", "internalClicks", "recirculation",
  "first24h", "first7d",
];

const regionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
function countryName(code: string): string {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

function FunnelBars({ funnel }: { funnel: Array<{ depth: number; reads: number; share: number | null }> }) {
  if (funnel.every((f) => f.reads === 0)) return <p className="adm-empty__body adm-left">No scroll data yet for this period.</p>;
  return (
    <ul className="adm-funnel">
      {funnel.map((f) => (
        <li key={f.depth}>
          <span className="adm-funnel__label">{f.depth}%</span>
          <span className="adm-funnel__track"><span style={{ width: `${f.share ?? 0}%` }} /></span>
          <span className="adm-funnel__val">{formatPercent(f.share)} <small>({formatCount(f.reads)})</small></span>
        </li>
      ))}
    </ul>
  );
}

function PageList({ title, rows, empty }: { title: string; rows: Array<{ id: string; title: string; sessions: number }>; empty: string }) {
  return (
    <div className="adm-panel adm-panel__body">
      <h3 className="adm-card-title">{title}</h3>
      {rows.length === 0 ? (
        <p className="adm-empty__body adm-left">{empty}</p>
      ) : (
        <table className="adm-table--compact">
          <thead><tr><th>Article</th><th className="text-right">Sessions</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link to="/admin/stats/article/$id" params={{ id: r.id }}>{r.title}</Link></td>
                <td className="text-right">{formatCount(r.sessions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AnnotationsPanel({ annotations, defaultDate }: { annotations: Array<{ id: string; date: string; note: string; kind: "manual" | "publish" }>; defaultDate: string }) {
  const router = useRouter();
  const [date, setDate] = useState(defaultDate);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (data: { action: "add" | "delete"; id?: string; date?: string; note?: string }) => {
    setBusy(true);
    setErr(null);
    try {
      await adminStatsAnnotation({ data });
      setNote("");
      await router.invalidate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the note.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="adm-panel adm-panel__body">
      <h3 className="adm-card-title">Chart annotations</h3>
      <p className="adm-panel__note">Publish dates are added automatically; add your own notes (campaigns, outages, shares). They appear as dotted lines on the page-views chart.</p>
      <form
        className="adm-annot-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim()) void run({ action: "add", date, note });
        }}
      >
        <input type="date" className="adm-input" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Annotation date" required />
        <input type="text" className="adm-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note, e.g. Shared on X" maxLength={200} aria-label="Annotation note" required />
        <button type="submit" className="adm-btn" disabled={busy}>Add note</button>
      </form>
      {err ? <p className="adm-banner adm-banner--bad">{err}</p> : null}
      {annotations.length === 0 ? (
        <p className="adm-empty__body adm-left">No annotations in this period.</p>
      ) : (
        <ul className="adm-annot-list">
          {annotations.map((a) => (
            <li key={a.id}>
              <span className="adm-annot-date">{shortDate(a.date)}</span>
              <span className="adm-annot-note">{a.note}</span>
              {a.kind === "manual" ? (
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy} onClick={() => void run({ action: "delete", id: a.id })} aria-label={`Delete note ${a.note}`}>
                  Delete
                </button>
              ) : (
                <span className="adm-chip adm-chip--subtle">auto</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LeaderboardTable({
  rows,
  pageCount,
  page,
  pageSize,
  total,
  onSort,
  onPageChange,
  currentSort,
}: {
  rows: LeaderboardRow[];
  pageCount: number;
  page: number;
  pageSize: number;
  total: number;
  onSort: (key: string) => void;
  onPageChange: (page: number) => void;
  currentSort: string;
}) {
  const [tableSorting, setTableSorting] = useState<{ id: string; desc: boolean }[]>([]);

  useEffect(() => {
    if (!currentSort) {
      setTableSorting([]);
      return;
    }
    setTableSorting([{ id: currentSort.replace(/-$/, ""), desc: !currentSort.endsWith("-") }]);
  }, [currentSort]);

  const table = useReactTable<LeaderboardRow>({
    columns,
    data: rows,
    pageCount,
    manualPagination: true,
    manualSorting: true,
    state: {
      sorting: tableSorting,
      pagination: { pageIndex: page - 1, pageSize },
    },
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            {table.getHeaderGroups().flatMap((group) =>
              group.headers.map((header) => {
                const id = header.id;
                const sortable = sortableColumnIds.includes(id);
                const headerContent = header.column.columnDef.header;
                const renderedHeader =
                  typeof headerContent === "function"
                    ? headerContent({ column: header.column, table } as any)
                    : headerContent;
                return (
                  <th
                    key={id}
                    onClick={() => sortable && onSort(id)}
                    style={{ cursor: sortable ? "pointer" : "default" }}
                    aria-sort={currentSort === id ? "descending" : currentSort === `${id}-` ? "ascending" : undefined}
                  >
                    {header.isPlaceholder ? null : renderedHeader}
                    {sortable ? (
                      <span className="adm-sort-indicator">
                        {currentSort === id ? " ▼" : currentSort === `${id}-` ? " ▲" : ""}
                      </span>
                    ) : null}
                  </th>
                );
              }),
            )}
          </tr>
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="adm-empty-cell">No matching articles.</td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => {
                  const renderer = cell.column.columnDef.cell;
                  const content =
                    typeof renderer === "function" ? renderer(cell as any) : cell.getValue();
                  return <td key={cell.id}>{content}</td>;
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="adm-pagination">
        <p className="adm-pagination__count">
          Showing {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
        </p>
        <div className="adm-pagination__controls">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="adm-btn adm-btn--ghost"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page >= pageCount || pageCount === 0}
            onClick={() => onPageChange(page + 1)}
            className="adm-btn adm-btn--ghost"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty / error states
// ---------------------------------------------------------------------------

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="adm-banner adm-banner--bad" role="alert">
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Insights (deterministic observations)
// ---------------------------------------------------------------------------

type Insight = { kind: "up" | "down" | "neutral" | "info"; title: string; body: string };

function buildInsights(stats: AdminStats): Insight[] {
  const { overview, leaderboard, topics, sources, recirculation, publishing } = stats;
  const insights: Insight[] = [];

  if (!insightsAllowed(overview.sessions)) return [];
  const pvChange = deltaPercent(overview.pageViews, overview.prevPageViews, overview.prevHasData);
  if (pvChange !== null) {
    insights.push({
      kind: pvChange > 5 ? "up" : pvChange < -5 ? "down" : "neutral",
      title: "Traffic vs previous period",
      body: `Page views ${pvChange > 0 ? "rose" : pvChange < 0 ? "fell" : "were flat"} by ${Math.abs(pvChange)}% compared with the previous equivalent period (${overview.period.label}).`,
    });
  }

  if (overview.prevHasData && overview.engagementRate !== null && overview.prevEngagementRate !== null) {
    const erChange = Math.round(overview.engagementRate - overview.prevEngagementRate);
    if (Math.abs(erChange) >= 1) {
      insights.push({
        kind: erChange > 0 ? "up" : "down",
        title: "Engagement rate shift",
        body: `Engagement rate changed by ${erChange > 0 ? "+" : ""}${erChange} percentage points versus the previous period.`,
      });
    }
  }

  const topCategory = topics.categories[0];
  if (topCategory && topics.categories.length > 1) {
    const share = overview.pageViews > 0 ? (topCategory.views / overview.pageViews) * 100 : 0;
    if (topCategory.views > 0 && share > 30) {
      insights.push({
        kind: "info",
        title: "Concentrated topic interest",
        body: `${topCategory.label} accounts for ${share.toFixed(0)}% of measured article traffic in ${overview.period.label} — consider publishing more in this area.`,
      });
    }
  }

  const longTail = leaderboard.rows.filter((r) => r.ageDays != null && r.ageDays > 180 && r.views > 0);
  if (longTail.length > 0) {
    insights.push({
      kind: "neutral",
      title: "Older articles still reading",
      body: `${longTail.length} article${longTail.length > 1 ? "s" : ""} older than 6 months attracted ${longTail.reduce((s, r) => s + r.views, 0)} views this period.`,
    });
  }

  const highViewsLowCompletion = leaderboard.rows.filter((r) => r.views > 0 && r.completionRate != null && r.completionRate < 30 && r.views >= 50);
  if (highViewsLowCompletion.length > 0) {
    const worst = highViewsLowCompletion.sort((a, b) => a.completionRate! - b.completionRate!)[0];
    insights.push({
      kind: "down",
      title: "Traffic without reading",
      body: `"${worst.title}" has strong traffic (${worst.views} views) but only ${formatPercent(worst.completionRate)} read completion — worth reviewing the lede or match to search intent.`,
    });
  }

  const highEngagementLowViews = leaderboard.rows.filter((r) => r.views > 0 && r.engagementRate != null && r.engagementRate > 70 && r.views < 100);
  if (highEngagementLowViews.length > 0) {
    const best = highEngagementLowViews.sort((a, b) => b.views - a.views)[0];
    insights.push({
      kind: "up",
      title: "Hidden gem",
      body: `"${best.title}" engages ${formatPercent(best.engagementRate)} of its reading sessions despite modest traffic — a candidate for featuring or linking from popular articles.`,
    });
  }

  const betterSource = sources.rows
    .filter((s) => s.engagementRate != null && s.sessions > 0 && s.sessions < Math.max(1, Math.round((sources.rows.reduce((a, b) => a + b.sessions, 0) / sources.rows.length))))
    .sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0))[0];
  if (betterSource) {
    insights.push({
      kind: "neutral",
      title: "Engaged source, smaller audience",
      body: `${betterSource.source} (${betterSource.medium}) sent ${betterSource.sessions} sessions with ${formatPercent(betterSource.engagementRate)} engagement — stronger per-visit reading than the average source.`,
    });
  }

  if (recirculation.multiArticleRate != null && recirculation.multiArticleRate < 15 && recirculation.sessions > 10) {
    insights.push({
      kind: "down",
      title: "Weak article-to-article recirculation",
      body: `Only ${formatPercent(recirculation.multiArticleRate)} of sessions read more than one article. More related-article links could deepen visits.`,
    });
  }

  const declining = publishing.ageCohorts.filter((c) => c.label === "Over 6 months" && c.avgViews != null);
  if (declining[0]?.avgViews != null) {
    insights.push({
      kind: "info",
      title: "Long tail is real",
      body: `Articles older than 6 months average ${formatCount(declining[0].avgViews)} measured views — evergreen content keeps working after publication.`,
    });
  }

  return insights.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function StatsPage() {
  const routeData = Route.useLoaderData();
  const data = routeData.data ?? null;
  const error = routeData.error ?? null;
  const search = Route.useSearch();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  if (!data) {
    if (error === "not-signed-in") return null; // parent renders sign-in
    return <ErrorBanner message={error ?? "Failed to load stats."} />;
  }

  const {
    overview,
    leaderboard,
    topics,
    sources,
    devices,
    distribution,
    recirculation,
    publishing,
    extras,
  } = data;
  const period = overview.period;

  const handlePreset = (next: DatePreset) => {
    void router.navigate({ to: "/admin/stats", search: { preset: next, from: undefined, to: undefined, page: "1" } });
  };

  const handleCustom = (from: string, to: string) => {
    void router.navigate({ to: "/admin/stats", search: { preset: "custom", from, to, page: "1" } });
  };

  const handleSort = (key: string) => {
    const current = search.sort ?? "";
    let next: string;
    if (current === key) next = `${key}-`;
    else if (current === `${key}-`) next = key;
    else next = key;
    void router.navigate({ to: "/admin/stats", search: { ...search, sort: next, page: "1" } as Search });
  };

  const handlePageChange = (next: number) => {
    void router.navigate({ to: "/admin/stats", search: { ...search, page: String(next) } as Search });
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await router.invalidate();
    setRefreshing(false);
  };

  const exportUrl = (table: string) => {
    const params = new URLSearchParams({ table, preset: period.preset, from: period.from, to: period.to });
    if (search.categoryId) params.set("categoryId", search.categoryId);
    if (search.tagId) params.set("tagId", search.tagId);
    if (search.q) params.set("q", search.q);
    return `/api/analytics/export?${params.toString()}`;
  };

  const insights = buildInsights(data);

  const prior = overview.prevHasData;
  const pct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v}%`);
  const trendOf = (v: number | null, invert = false) => (v === null ? null : v === 0 ? "neutral" : (v > 0) !== invert ? "up" : "down");
  const pvDelta = deltaPercent(overview.pageViews, overview.prevPageViews, prior);
  const sessDelta = deltaPercent(overview.sessions, overview.prevSessions, prior);
  const usersDelta = deltaPercent(overview.users, overview.prevUsers, prior);
  const avgDelta = deltaPercent(overview.avgEngagementTime, overview.prevAvgEngagementTime, prior);
  const engTotalDelta = deltaPercent(overview.totalEngagedTime, overview.prevTotalEngagedTime, prior);
  const pts = (cur: number | null, prev: number | null) =>
    prior && cur !== null && prev !== null ? Math.round((cur - prev) * 10) / 10 : null;
  const erPts = pts(overview.engagementRate, overview.prevEngagementRate);
  const brPts = pts(overview.bounceRate, overview.prevBounceRate);
  const ptsLabel = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)} pts`);

  const pageCount = Math.max(1, Math.ceil(leaderboard.total / leaderboard.pageSize));

  const presets: { id: DatePreset; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "yesterday", label: "Yesterday" },
    { id: "last-7", label: "Last 7 days" },
    { id: "last-28", label: "Last 28 days" },
    { id: "last-90", label: "Last 90 days" },
    { id: "last-12-months", label: "Last 12 months" },
    { id: "custom", label: "Custom range" },
  ];

  return (
    <div className="adm-stats-page">
      <div className="adm-stats__header">
        <div>
          <p className="desk-kicker">Stats &amp; analytics</p>
          <h1 className="desk-title">Editorial dashboard</h1>
          <p className="desk-note">
            First-party readership measurement for DYPOL Blog. Reporting timezone:
            Asia/Kolkata (IST){" "}
            <HelpTip text="All dates and rollups use Asia/Kolkata (UTC+5:30). Metrics are computed from the site's first-party beacon and the cumulative article view counter; GA4 is installed on the site but its reporting API is not connected to this dashboard." />
          </p>
        </div>
        <div className="adm-stats__actions">
          <a href={exportUrl("overview")} className="adm-btn adm-btn--ghost" title="Download the overview metrics and daily series as CSV">
            <Download size={16} /> Overview CSV
          </a>
          <button type="button" className="adm-btn adm-btn--ghost" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? <Clock size={16} className="animate-spin" /> : <Clock size={16} />} Refresh
          </button>
        </div>
      </div>

      {/* Global filters */}
      <section className="adm-filters">
        <div className="adm-filters__presets">
          {presets.map((p) => {
            const active = period.preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handlePreset(p.id)}
                className={`adm-chip ${active ? "adm-chip--active" : ""}`}
              >
                {p.label}
              </button>
            );
          })}
          {period.preset === "custom" && (
            <>
              <label className="adm-chip">
                From <input type="date" defaultValue={period.from} onChange={(e) => handleCustom(e.target.value, period.to)} />
              </label>
              <label className="adm-chip">
                To{" "}
                <input type="date" defaultValue={period.to} onChange={(e) => handleCustom(period.from, e.target.value)} />
              </label>
            </>
          )}
        </div>
        <div className="adm-filters__status">
          <span className="adm-chip adm-chip--subtle">
            {period.fromLabel} &rarr; {period.toLabel} &middot; {period.granularity} view
          </span>
          {overview.freshness ? (
            <span className="adm-chip adm-chip--subtle">
              Data through {overview.freshness}
            </span>
          ) : null}
        </div>
      </section>

      {error && <ErrorBanner message={error} />}

      {/* Overview KPIs */}
      <section className="adm-section">
        <div className="adm-section__head">
          <h2>Overview</h2>
          <p className="adm-section__desc">
            Page views, sessions and engaged time in {period.label.toLowerCase()}
            {prior ? " vs the previous equivalent period" : ""}.
          </p>
        </div>
        <div className="stat-grid adm-stat-grid">
          <StatCard
            title="Page views"
            value={formatCount(overview.pageViews)}
            noPrior={!prior}
            delta={pct(pvDelta)}
            trend={trendOf(pvDelta)}
            deltaLabel="vs previous period"
            help="Article page views measured by the first-party beacon (bots excluded) in the selected period."
          />
          <StatCard
            title="Sessions"
            value={formatCount(overview.sessions)}
            noPrior={!prior}
            delta={pct(sessDelta)}
            trend={trendOf(sessDelta)}
            help="One session = one reader on one IST day (same source as the charts)."
          />
          <StatCard
            title="Users"
            value={formatCount(overview.users)}
            noPrior={!prior}
            delta={pct(usersDelta)}
            trend={trendOf(usersDelta)}
            help="Distinct readers (random first-party id, no IP stored) in the period."
          />
          <StatCard
            title="New / returning"
            value={`${formatCount(overview.newUsers)} / ${formatCount(overview.returningUsers)}`}
            help="Returning = visited on more than one day within the last 30 days."
          />
          <StatCard
            title="Avg engaged time"
            value={overview.avgEngagementTime != null ? formatDuration(overview.avgEngagementTime) : "—"}
            noPrior={!prior}
            delta={pct(avgDelta)}
            trend={trendOf(avgDelta)}
            help="Total engaged time ÷ page views (visible, active time only)."
          />
          <StatCard
            title="Engagement rate"
            value={formatPercent(overview.engagementRate)}
            noPrior={!prior}
            delta={ptsLabel(erPts)}
            trend={trendOf(erPts)}
            help="GA4 definition: engaged sessions (≥10s engaged, or 2+ page views, or an internal article click) ÷ sessions."
          />
          <StatCard
            title="Bounce rate"
            value={formatPercent(overview.bounceRate)}
            noPrior={!prior}
            delta={ptsLabel(brPts)}
            trend={trendOf(brPts, true)}
            help="100% − engagement rate (GA4 definition)."
          />
          <StatCard
            title="Total engaged time"
            value={formatDuration(overview.totalEngagedTime)}
            noPrior={!prior}
            delta={pct(engTotalDelta)}
            trend={trendOf(engTotalDelta)}
            help="Sum of visible, active reading time across all article reads in the period."
          />
          <StatCard
            title="Published articles"
            value={formatCount(overview.publishedArticles)}
            help="All currently published articles."
          />
          <StatCard
            title="Published in period"
            value={formatCount(overview.publishedInPeriod)}
            help="Articles whose publication date (IST) falls inside the selected period."
          />
        </div>
      </section>

      {/* Trends */}
      <section className="adm-section adm-section--two-col">
        <div className="adm-panel">
          <LineTrendChart
            series={overview.series}
            previousSeries={overview.previousSeries}
            valueKey="pageViews"
            label="Page views over time"
            showPrevious={true}
            annotations={extras.annotations}
          />
        </div>
        <div className="adm-panel">
          <LineTrendChart series={overview.series} valueKey="sessions" label="Sessions over time" area />
        </div>
        <div className="adm-panel">
          <ComparisonTable
            hasPrior={prior}
            rows={[
              { label: "Page views", current: formatCount(overview.pageViews), previous: formatCount(overview.prevPageViews), change: pct(pvDelta) },
              { label: "Sessions", current: formatCount(overview.sessions), previous: formatCount(overview.prevSessions), change: pct(sessDelta) },
              { label: "Users", current: formatCount(overview.users), previous: formatCount(overview.prevUsers), change: pct(usersDelta) },
              { label: "Engagement rate", current: formatPercent(overview.engagementRate), previous: formatPercent(overview.prevEngagementRate), change: ptsLabel(erPts) },
              { label: "Bounce rate", current: formatPercent(overview.bounceRate), previous: formatPercent(overview.prevBounceRate), change: ptsLabel(brPts) },
              { label: "Avg engaged time", current: overview.avgEngagementTime != null ? formatDuration(overview.avgEngagementTime) : "—", previous: overview.prevAvgEngagementTime != null ? formatDuration(overview.prevAvgEngagementTime) : "—", change: pct(avgDelta) },
            ]}
          />
        </div>
      </section>

      {/* Reader engagement */}
      <section className="adm-section">
        <div className="adm-section__head">
          <h2>Reader engagement &amp; reading time</h2>
          <p className="adm-section__desc">
            Whether visitors genuinely read articles — visible, active time only; abandoned tabs don&rsquo;t count.
          </p>
        </div>
        <div className="adm-panel-grid adm-panel-grid--engagement">
          <div className="adm-panel">
            <HistogramChart buckets={distribution.buckets} />
          </div>
          <div className="adm-panel">
            <div className="adm-panel__body">
              <h3 className="adm-card-title">Reading-time statistics</h3>
              <table className="adm-table--compact">
                <tbody>
                  <tr><td>Recorded session-article reads</td><td className="text-right">{formatCount(distribution.stats?.count ?? 0)}</td></tr>
                  <tr><td>Average engaged time</td><td className="text-right">{formatDuration(distribution.stats?.average ?? 0)}</td></tr>
                  <tr><td>Median engaged time</td><td className="text-right">{formatDuration(distribution.stats?.median ?? 0)}</td></tr>
                  <tr><td>75th percentile</td><td className="text-right">{formatDuration(distribution.stats?.p75 ?? 0)}</td></tr>
                  <tr><td>90th percentile</td><td className="text-right">{formatDuration(distribution.stats?.p90 ?? 0)}</td></tr>
                </tbody>
              </table>
              <p className="adm-panel__note">
                {distribution.notes.join(" ")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Article leaderboard */}
      <section className="adm-section">
        <div className="adm-section__head">
          <h2>Article leaderboard</h2>
          <p className="adm-section__desc">
            Searchable ranking of published articles, sorted by page views by default. Click a column
            header to sort by it (▼ high → low, ▲ low → high).
          </p>
          <div className="adm-table-actions">
            <input
              type="search"
              placeholder="Search title or slug…"
              defaultValue={search.q ?? ""}
              onChange={(e) => void router.navigate({ to: "/admin/stats", search: { ...search, q: e.target.value, page: "1" } as Search })}
              className="adm-input"
            />
            <label className="adm-select-field">
              Category
              <select value={search.categoryId ?? ""} onChange={(e) => void router.navigate({ to: "/admin/stats", search: { ...search, categoryId: e.target.value || null, page: "1" } as Search })} className="adm-select">
                <option value="">All</option>
                {topics.categories.map((c: TopicRow) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </label>
            <a href={exportUrl("articles")} className="adm-btn adm-btn--ghost" title="Download the leaderboard as CSV" aria-label="Export leaderboard as CSV">
              <Download size={16} /> Export CSV
            </a>
          </div>
        </div>
        <LeaderboardTable
          rows={leaderboard.rows}
          page={leaderboard.page}
          pageSize={leaderboard.pageSize}
          total={leaderboard.total}
          pageCount={pageCount}
          currentSort={search.sort ?? "views"}
          onSort={handleSort}
          onPageChange={handlePageChange}
        />
        <p className="adm-panel__note">{leaderboard.notes.join(" ")}</p>
      </section>

      {/* Topics */}
      <section className="adm-section adm-section--two-col">
        <div className="adm-panel">
          <HorizontalBarChart
            data={topics.categories.slice(0, 10).map((c: TopicRow) => ({ name: c.label, value: c.views }))}
            label="Page views by category"
            emptyMessage="No category views yet for this period."
          />
        </div>
        <div className="adm-panel">
          <HorizontalBarChart
            data={topics.categories.slice(0, 10).map((c: TopicRow) => ({ name: c.label, value: c.sessions }))}
            label="Reading sessions by category"
            emptyMessage="No category sessions yet for this period."
          />
        </div>
        <div className="adm-panel">
          <DonutChart
            data={topics.categories.slice(0, 8).map((c: TopicRow) => ({ name: c.label, value: c.views }))}
            label="Share of article traffic by category"
            emptyMessage="No article traffic yet for this period."
          />
        </div>
        <div className="adm-panel">
          <HorizontalBarChart
            data={topics.tags.slice(0, 10).map((t: { id: string; label: string; views: number; articles: number }) => ({ name: t.label, value: t.views }))}
            label="Top tags (topics) by views"
            emptyMessage="No tagged article views yet for this period."
          />
        </div>
      </section>

      {/* Tags breakdown */}
      <section className="adm-section">
        <div className="adm-panel adm-panel__body">
          <h3 className="adm-card-title">Tag (topic) breakdown</h3>
          {topics.tags.length === 0 ? (
            <p className="adm-empty__body adm-left">No tags yet.</p>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead><tr><th>Tag</th><th className="text-right">Articles</th><th className="text-right">Views</th><th className="text-right"><abbr title="Engaged time ÷ page views">Avg eng.</abbr></th></tr></thead>
                <tbody>
                  {topics.tags.map((t) => (
                    <tr key={t.id}>
                      <td>{t.label}</td>
                      <td className="text-right">{formatCount(t.articles)}</td>
                      <td className="text-right">{formatCount(t.views)}</td>
                      <td className="text-right">{t.avgEngagedTime == null ? "—" : formatDuration(t.avgEngagedTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="adm-panel__note">{topics.notes.join(" ")} Author breakdown will appear once articles carry bylines.</p>
        </div>
      </section>

      {/* Traffic acquisition */}
      <section className="adm-section adm-section--two-col">
        <div className="adm-panel">
          <DonutChart
            data={sources.rows.map((s: SourceRow) => ({ name: `${s.source} · ${s.medium}`, value: s.sessions }))}
            label="Sessions by source · medium"
            emptyMessage="No source data yet for this period."
          />
        </div>
        <div className="adm-panel">
          <HorizontalBarChart
            data={sources.referrers.map((r: { domain: string; sessions: number }) => ({ name: r.domain, value: r.sessions }))}
            label="Top referring websites"
            emptyMessage="No referrer data yet — visits so far are direct or internal."
          />
        </div>
        <div className="adm-panel">
          <DonutChart
            data={devices.rows.map((d: DeviceRow) => ({ name: d.device, value: d.sessions }))}
            label="Sessions by device"
            emptyMessage="No device data yet for this period."
          />
        </div>
        <div className="adm-panel adm-panel__body">
          <h3 className="adm-card-title">Source · medium performance</h3>
          {sources.rows.length === 0 ? <p className="adm-empty__body adm-left">No source data yet for this period.</p> : null}
          <table className="adm-table--compact">
            <thead>
              <tr><th>Source · medium</th><th className="text-right">Sessions</th><th className="text-right">Engagement</th><th className="text-right">Views / session</th></tr>
            </thead>
            <tbody>
              {sources.rows.map((s: SourceRow) => (
                <tr key={`${s.source}|${s.medium}`}>
                  <td>{s.source} · {s.medium}</td>
                  <td className="text-right">{formatCount(s.sessions)}</td>
                  <td className="text-right">{formatPercent(s.engagementRate)}</td>
                  <td className="text-right">{s.viewsPerSession != null ? s.viewsPerSession.toFixed(2) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="adm-panel__note">{sources.notes.join(" ")}</p>
        </div>
      </section>

      {/* Geography, scroll funnel, entry/exit, search */}
      <section className="adm-section adm-section--two-col">
        <div className="adm-panel">
          <HorizontalBarChart
            data={devices.countries.slice(0, 12).map((c) => ({ name: countryName(c.country), value: c.sessions }))}
            label="Geography — sessions by country"
            emptyMessage="No country data yet — recorded from this release onward (country code only, no IP)."
          />
        </div>
        <div className="adm-panel adm-panel__body">
          <h3 className="adm-card-title">Scroll-depth funnel</h3>
          <FunnelBars funnel={extras.funnel} />
          <p className="adm-panel__note">{extras.notes[0]}</p>
        </div>
        <PageList title="Entry pages" rows={extras.entryPages} empty="No entry-page data yet — recorded from this release onward." />
        <PageList title="Exit pages" rows={extras.exitPages} empty="No exit-page data yet — recorded from this release onward." />
        <div className="adm-panel adm-panel__body">
          <h3 className="adm-card-title">Site search terms</h3>
          {extras.searchTerms.length === 0 ? (
            <p className="adm-empty__body adm-left">No searches recorded yet for this period.</p>
          ) : (
            <table className="adm-table--compact">
              <thead><tr><th>Term</th><th className="text-right">Searches</th><th className="text-right">Results</th></tr></thead>
              <tbody>
                {extras.searchTerms.map((t) => (
                  <tr key={t.term}>
                    <td>{t.term}</td>
                    <td className="text-right">{formatCount(t.count)}</td>
                    <td className={`text-right${t.results === 0 ? " adm-zero" : ""}`}>{t.results === 0 ? "0 — content gap" : formatCount(t.results)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="adm-panel__note">{extras.notes[2]}</p>
        </div>
        <AnnotationsPanel annotations={extras.annotations} defaultDate={period.to} />
      </section>

      {/* Recirculation */}
      <section className="adm-section adm-section--two-col">
        <div className="adm-panel">
          <div className="adm-panel__body">
            <h3 className="adm-card-title">Article recirculation</h3>
            <div className="adm-stat-grid adm-stat-grid--mini">
              <StatCard
                title="Site click-through"
                value={formatPercent(recirculation.clickThroughRate)}
                help="Site-level recirculation: internal article clicks ÷ article page views. Per-article values are in the leaderboard (Recirc. %)."
              />
              <StatCard
                title="Multi-article sessions"
                value={formatPercent(recirculation.multiArticleRate)}
                help="Site-level: sessions that read 2+ different articles ÷ all sessions."
              />
              <StatCard title="Avg articles / session" value={recirculation.avgArticlesPerSession != null ? recirculation.avgArticlesPerSession.toFixed(2) : "—"} />
            </div>
            {recirculation.topLinks.length > 0 ? (
              <table className="adm-table--compact">
                <thead>
                  <tr><th>From → to</th><th className="text-right">Internal clicks</th></tr>
                </thead>
                <tbody>
                  {recirculation.topLinks.map((l: { fromTitle: string; toTitle: string; clicks: number }) => (
                    <tr key={`${l.fromTitle}|${l.toTitle}`}>
                      <td>{l.fromTitle} &rarr; {l.toTitle}</td>
                      <td className="text-right">{formatCount(l.clicks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="adm-empty__body">No internal article clicks recorded yet.</p>
            )}
            <p className="adm-panel__note">{recirculation.notes.join(" ")}</p>
          </div>
        </div>
        <div className="adm-panel">
          <div className="adm-panel__body">
            <h3 className="adm-card-title">Publishing performance</h3>
            <HorizontalBarChart
              data={publishing.byMonth.map((m: { periodLabel: string; published: number; avgViewsFirst28Days: number | null }) => ({ name: m.periodLabel, value: m.published }))}
              label="Articles published by month"
            />
            <table className="adm-table--compact adm-mt">
              <thead>
                <tr><th>Article age</th><th className="text-right">Articles</th><th className="text-right">Avg measured views</th></tr>
              </thead>
              <tbody>
                {publishing.ageCohorts.map((c: { label: string; articles: number; avgViews: number | null }) => (
                  <tr key={c.label}>
                    <td>{c.label}</td>
                    <td className="text-right">{formatCount(c.articles)}</td>
                    <td className="text-right">{c.avgViews != null ? formatCount(c.avgViews) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="adm-panel__note">{publishing.notes.join(" ")}</p>
          </div>
        </div>
      </section>

      {/* Insights */}
      <section className="adm-section">
        <h2>Editorial insights</h2>
        <div className="adm-insight-grid">
          {!insightsAllowed(overview.sessions) ? (
            <p className="adm-empty__body adm-left">
              Insights are suppressed until the period has at least {INSIGHT_MIN_SESSIONS} sessions (n = {formatCount(overview.sessions)}) — smaller samples are noise.
            </p>
          ) : insights.length === 0 ? (
            <p className="adm-empty__body adm-left">No significant observations for this period yet.</p>
          ) : (
            insights.map((insight, i) => (
              <div key={i} className={`adm-insight adm-insight--${insight.kind}`}>
                <strong>{insight.title}</strong>
                <p>{insight.body}</p>
              </div>
            ))
          )}
        </div>
        <p className="adm-panel__note adm-small">
          Observations are deterministic comparisons against the previous equivalent period ({period.previousFrom} &rarr; {period.previousTo}). Correlations are described, not causation.
        </p>
      </section>

      {/* Data sources & availability */}
      <section className="adm-section adm-card--bordered">
        <h2>Data sources &amp; availability</h2>
        <table className="adm-table--compact">
          <thead>
            <tr><th>Source</th><th>Status</th><th>What it feeds</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>First-party beacon (this site)</td>
              <td className="adm-status adm-status--ok">Measuring</td>
              <td>Page views, sessions, engagement time, scroll depth, sources, devices, recirculation</td>
            </tr>
            <tr>
              <td>Cumulative article view counter</td>
              <td className="adm-status adm-status--ok">Active</td>
              <td>Raw hits (all-time) in the leaderboard — includes bots and repeat loads</td>
            </tr>
            <tr>
              <td>Google Analytics 4 (G-T1R0QJ2F0Z)</td>
              <td className="adm-status adm-status--off">Installed, reporting API not connected</td>
              <td>Not connected — no GA4 data appears here. To import GA4 users/sessions/source-medium, configure GA4 Data API credentials on the server.</td>
            </tr>
            <tr>
              <td>Google Search Console</td>
              <td className="adm-status adm-status--off">Not connected</td>
              <td>Search impressions/clicks/CTR/position are not shown. Connect Search Console to add the SEO section.</td>
            </tr>
            <tr>
              <td>Geography</td>
              <td className="adm-status adm-status--ok">Measuring (country only)</td>
              <td>Two-letter country code from Cloudflare's edge; no IP address, city or region is stored.</td>
            </tr>
          </tbody>
        </table>
        <p className="adm-panel__note adm-small">
          Nothing is fabricated: "no data" means nothing was measured, never zero substituted for an error. Period metrics require the first-party beacon,
          which only starts recording after this feature is deployed; historical data before deployment is not available.
        </p>
      </section>
    </div>
  );
}
