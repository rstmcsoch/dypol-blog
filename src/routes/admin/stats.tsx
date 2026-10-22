import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createFileRoute,
  Link,
  useRouter,
} from "@tanstack/react-router";
import { adminStats } from "@/content/admin-api";
import type { TopicRow, SourceRow, DeviceRow } from "@/content/analytics.server";
import {
  formatCount,
  formatDuration,
  formatPercent,
  kolkataDisplayDate,
  type DatePreset,
} from "@/lib/analytics-dates";
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

export const Route = createFileRoute("/admin/stats")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const presets: DatePreset[] = [
      "today", "yesterday", "last-7", "last-28", "last-30", "last-90", "last-12-months", "custom",
    ];
    const preset =
      typeof search.preset === "string" && presets.includes(search.preset as DatePreset)
        ? search.preset
        : undefined;
    // A custom range needs both bounds; otherwise fall back to the default.
    const finalPreset = preset === "custom" && (!search.from || !search.to) ? undefined : (preset as DatePreset);
    return {
      preset: finalPreset,
      from: typeof search.from === "string" ? search.from : undefined,
      to: typeof search.to === "string" ? search.to : undefined,
      compare: search.compare === "1" || search.compare === "true" ? "1" : undefined,
      sort:
        search.sort === "views" || search.sort === "engagedTime" || search.sort === "completionRate" ||
        search.sort === "growth" || search.sort === "published" || search.sort === "title"
          ? (search.sort as Search["sort"])
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
      aria-describedby="help-tip"
      className="adm-help"
      title={text}
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
}: {
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
      {delta !== undefined ? (
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

function LineTrendChart({
  series,
  previousSeries,
  valueKey,
  label,
  valueFormat = formatter,
  height = 220,
  showPrevious = false,
}: {
  series: { date: string; pageViews: number; sessions: number; engagedSeconds: number }[];
  previousSeries?: { date: string; pageViews: number; sessions: number; engagedSeconds: number }[] | null;
  valueKey: "pageViews" | "sessions" | "engagedSeconds";
  label: string;
  valueFormat?: (v: number) => string;
  height?: number;
  showPrevious?: boolean;
}) {
  const data = useMemo<ChartPoint[]>(() => {
    return series.map((p) => ({ name: p.date, [valueKey]: p[valueKey] }));
  }, [series, valueKey]);
  const prevData = useMemo<ChartPoint[]>(() => {
    if (!showPrevious || !previousSeries) return [];
    return previousSeries.map((p) => ({ name: p.date, [valueKey]: p[valueKey] }));
  }, [previousSeries, valueKey, showPrevious]);

  return (
    <div className="adm-chart-wrap">
      <div className="adm-chart__label">{label}</div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 20, right: 24, bottom: 30, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6b7280" }} tickMargin={8} />
          <YAxis tickFormatter={valueFormat} tick={{ fontSize: 11, fill: "#6b7280" }} width={40} />
          <Tooltip
            cursor={{ fill: "transparent" }}
            content={({ active, payload }: any) => {
              if (active && payload && payload.length) {
                const entry = payload[0].payload as ChartPoint;
                return (
                  <div className="adm-tooltip">
                    <div className="adm-tooltip__date">{entry.name}</div>
                    <div className="adm-tooltip__value">{valueFormat(Number(entry[valueKey]))}</div>
                  </div>
                );
              }
              return null;
            }}
          />
          <Legend verticalAlign="top" align="right" height={30} />
          <Line
            type="monotone"
            dataKey={valueKey}
            stroke={COLORS[0]}
            strokeWidth={2}
            dot={false}
            strokeOpacity={0.9}
          />
          {showPrevious && prevData.length > 0 && (
            <Line
              type="monotone"
              data={prevData}
              dataKey={valueKey}
              stroke="#9ca3af"
              strokeWidth={2}
              dot={false}
              strokeDasharray="4 4"
              opacity={0.6}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function AreaTrendChart({
  series,
  valueKey,
  label,
  color = COLORS[1],
  height = 200,
}: {
  series: { date: string; pageViews: number; sessions: number; engagedSeconds: number }[];
  valueKey: "pageViews" | "sessions" | "engagedSeconds";
  label: string;
  color?: string;
  height?: number;
}) {
  const data = useMemo<ChartPoint[]>(
    () => series.map((p) => ({ name: p.date, [valueKey]: p[valueKey] })),
    [series, valueKey],
  );
  return (
    <div className="adm-chart-wrap">
      <div className="adm-chart__label">{label}</div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 16, right: 16, bottom: 26, left: 8 }}>
          <defs>
            <linearGradient id={`color-area-${valueKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.55} />
              <stop offset="95%" stopColor={color} stopOpacity={0.08} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6b7280" }} tickMargin={8} />
          <YAxis tickFormatter={formatter} tick={{ fontSize: 11, fill: "#6b7280" }} width={36} />
          <Tooltip content={({ active, payload }: any) => {
            if (active && payload && payload.length) {
              const entry = payload[0].payload as ChartPoint;
              return (
                <div className="adm-tooltip">
                  <div className="adm-tooltip__date">{entry.name}</div>
                  <div className="adm-tooltip__value">{formatCount(Number(entry[valueKey]))}</div>
                </div>
              );
            }
            return null;
          }} />
          <Area type="monotone" dataKey={valueKey} stroke={color} strokeWidth={2} fillOpacity={1} fill={`url(#color-area-${valueKey})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ComparisonBars({
  current,
  previous,
  metrics,
}: {
  current: Record<string, number | null>;
  previous: Record<string, number | null>;
  metrics: Array<{ key: string; label: string; format: (v: number) => string }>;
}) {
  const data = useMemo(
    () =>
      metrics.flatMap((m) => [
        { category: m.label, series: "Current period", value: current[m.key] ?? 0 },
        { category: m.label, series: "Previous period", value: previous[m.key] ?? 0 },
      ]),
    [current, previous, metrics],
  );
  return (
    <div className="adm-chart-wrap">
      <div className="adm-chart__label">Current vs previous period</div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 20, right: 20, bottom: 60, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="category" tick={{ fontSize: 11, fill: "#6b7280" }} />
          <YAxis tickFormatter={formatter} tick={{ fontSize: 11, fill: "#6b7280" }} width={36} />
          <Tooltip />
          <Legend />
          <Bar dataKey="value" stackId="a" fill={COLORS[0]} radius={[4, 4, 0, 0]} />
          <Bar dataKey="value" stackId="a" fill="#cbd5e0" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function DonutChart({
  data,
  label,
  colors = COLORS,
  height = 260,
}: {
  data: { name: string; value: number }[];
  label: string;
  colors?: string[];
  height?: number;
}) {
  const total = useMemo(() => data.reduce((sum, d) => sum + d.value, 0), [data]);
  return (
    <div className="adm-chart-wrap">
      <div className="adm-chart__label">{label}</div>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Tooltip
            content={({ active, payload }: any) => {
              if (active && payload && payload.length) {
                const entry = payload[0].payload as { name: string; value: number };
                const share = total > 0 ? ((entry.value / total) * 100).toFixed(1) : 0;
                return (
                  <div className="adm-tooltip">
                    <div className="adm-tooltip__date">{entry.name}</div>
                    <div className="adm-tooltip__value">{formatCount(entry.value)} ({share}%)</div>
                  </div>
                );
              }
              return null;
            }}
          />
          <Pie
            dataKey="value"
            nameKey="name"
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={90}
            fill="#888"
            paddingAngle={2}
            labelLine={false}
            label={{ fill: "#6b7280", fontSize: 11 }}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function HorizontalBarChart({
  data,
  label,
  height = 300,
}: {
  data: { name: string; value: number }[];
  label: string;
  height?: number;
}) {
  const sorted = useMemo(() => [...data].sort((a, b) => b.value - a.value), [data]);
  return (
    <div className="adm-chart-wrap">
      <div className="adm-chart__label">{label}</div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={sorted} margin={{ top: 15, right: 15, bottom: 8, left: 90 }} layout="vertical">
          <XAxis type="number" tickFormatter={formatter} tick={{ fontSize: 11, fill: "#6b7280" }} width={40} />
          <YAxis dataKey="name" type="category" tick={{ fontSize: 12, fill: "#1d2330" }} />
          <Tooltip cursor={{ fill: "transparent" }} />
          <Bar dataKey="value" fill="#2f5bea" radius={[0, 6, 6, 0]} />
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
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={buckets} margin={{ top: 15, right: 15, bottom: 30, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} />
          <YAxis type="number" domain={[0, max]} tickFormatter={formatter} tick={{ fontSize: 11, fill: "#6b7280" }} width={36} />
          <Tooltip cursor={{ fill: "transparent" }} />
          <Bar dataKey="count" fill="#2f5bea" radius={[0, 6, 6, 0]} />
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

const columns = [
  columnHelper.accessor("title", {
    header: "Article",
    cell: (info) => {
      const row = info.row.original;
      return (
        <Link to="/admin/articles/$id" params={{ id: row.id }}>
          {row.title}
        </Link>
      );
    },
  }),
  columnHelper.accessor("categoryLabel", {
    header: "Category",
    cell: (info) => info.getValue() || "—",
  }),
  columnHelper.accessor("tagLabels", {
    header: "Tags",
    cell: (info) => info.getValue().join(", ") || "—",
  }),
  columnHelper.accessor("publishedAt", {
    header: "Published",
    cell: (info) => {
      const published = info.getValue();
      return published ? kolkataDisplayDate(published) : "—";
    },
  }),
  columnHelper.accessor("ageDays", {
    header: "Age (days)",
    cell: (info) => (info.getValue() ?? null) === null ? "—" : info.getValue(),
  }),
  columnHelper.accessor("views", {
    header: "Page views",
    cell: (info) => formatCount(info.getValue()),
  }),
  columnHelper.accessor("allTimeViews", {
    header: "All-time views",
    cell: (info) => formatCount(info.getValue()),
  }),
  columnHelper.accessor("sessions", {
    header: "Reading sessions",
    cell: (info) => formatCount(info.getValue()),
  }),
  columnHelper.accessor("avgEngagementTime", {
    header: "Avg engaged time",
    cell: (info) => formatDuration(info.getValue() ?? 0),
  }),
  columnHelper.accessor("engagementRate", {
    header: "Engagement rate",
    cell: (info) => formatPercent(info.getValue()),
  }),
  columnHelper.accessor("completionRate", {
    header: "Read completion",
    cell: (info) => formatPercent(info.getValue()),
  }),
  columnHelper.accessor("growth", {
    header: "Growth vs prev.",
    cell: (info) => {
      const v = info.getValue();
      if (v === null) return "—";
      return `${v > 0 ? "+" : ""}${v}%`;
    },
  }),
  columnHelper.accessor("internalClicks", {
    header: "Internal clicks",
    cell: (info) => formatCount(info.getValue()),
  }),
];

const sortableColumnIds = [
  "title", "categoryLabel", "publishedAt", "ageDays", "views", "allTimeViews",
  "sessions", "avgEngagementTime", "engagementRate", "completionRate", "growth", "internalClicks",
];

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
                  <th key={id} onClick={() => sortable && onSort(id)} style={{ cursor: sortable ? "pointer" : "default" }}>
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

  const pvChange = overview.prevPageViews > 0 ? Math.round(((overview.pageViews - overview.prevPageViews) / overview.prevPageViews) * 100) : null;
  if (pvChange !== null) {
    insights.push({
      kind: pvChange > 5 ? "up" : pvChange < -5 ? "down" : "neutral",
      title: "Traffic vs previous period",
      body: `Page views ${pvChange > 0 ? "rose" : pvChange < 0 ? "fell" : "were flat"} by ${Math.abs(pvChange)}% compared with the previous equivalent period (${overview.period.label}).`,
    });
  }

  if (overview.engagementRate !== null && overview.prevEngagementRate !== null) {
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

  if (recirculation.recirculationRate != null && recirculation.recirculationRate < 15 && recirculation.sessions > 10) {
    insights.push({
      kind: "down",
      title: "Weak article-to-article recirculation",
      body: `Only ${formatPercent(recirculation.recirculationRate)} of sessions read more than one article. More related-article links could deepen visits.`,
    });
  }

  const declining = publishing.ageCohorts.filter((c) => c.label === "Over 6 months" && c.avgViews != null);
  if (declining[0]?.avgViews != null) {
    insights.push({
      kind: "info",
      title: "Long tail is real",
      body: `Articles older than 6 months average ${formatCount(declining[0].avgViews)} cumulative views — evergreen content keeps working after publication.`,
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

  const pvDelta = overview.prevPageViews > 0 ? Math.round(((overview.pageViews - overview.prevPageViews) / overview.prevPageViews) * 100) : null;
  const sessDelta = overview.prevSessions > 0 ? Math.round(((overview.sessions - overview.prevSessions) / overview.prevSessions) * 100) : null;

  const pageCount = Math.max(1, Math.ceil(leaderboard.total / leaderboard.pageSize));

  const presets: { id: DatePreset; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "yesterday", label: "Yesterday" },
    { id: "last-7", label: "Last 7 days" },
    { id: "last-28", label: "Last 28 days" },
    { id: "last-30", label: "Last 30 days" },
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
            Page views, sessions and engaged time in {period.label}{" "}
            {overview.prevPageViews > 0 ? ` vs the previous equivalent period` : ""}.
          </p>
        </div>
        <div className="stat-grid adm-stat-grid">
          <StatCard
            title="Page views"
            value={formatCount(overview.pageViews)}
            delta={pvDelta !== null ? `${pvDelta > 0 ? "+" : ""}${pvDelta}%` : "—"}
            trend={pvDelta === null ? null : pvDelta > 0 ? "up" : pvDelta < 0 ? "down" : "neutral"}
            deltaLabel="vs previous period"
            help="Article page views measured by the first-party beacon in the selected period."
          />
          <StatCard
            title="Sessions"
            value={formatCount(overview.sessions)}
            delta={sessDelta !== null ? `${sessDelta > 0 ? "+" : ""}${sessDelta}%` : "—"}
            trend={sessDelta === null ? null : sessDelta > 0 ? "up" : sessDelta < 0 ? "down" : "neutral"}
            help="Sessions with at least one article view, session-based estimate (30-day cookie)."
          />
          <StatCard
            title="Users (estimate)"
            value={formatCount(overview.users)}
            help="Session-based user estimate; not a census of real people."
          />
          <StatCard
            title="New / returning"
            value={`${formatCount(overview.newUsers)} / ${formatCount(overview.returningUsers)}`}
            help="Sessions starting in the period vs sessions started earlier and seen again."
          />
          <StatCard
            title="Avg engaged time"
            value={overview.avgEngagementTime != null ? formatDuration(overview.avgEngagementTime) : "—"}
            delta={
              overview.prevAvgEngagementTime !== null
                ? `${overview.avgEngagementTime != null && overview.prevAvgEngagementTime > 0
                    ? Math.round(((overview.avgEngagementTime - overview.prevAvgEngagementTime) / overview.prevAvgEngagementTime) * 100)
                    : 0
                  }%`
                : "—"
            }
            trend={overview.prevAvgEngagementTime === null ? null : overview.avgEngagementTime! > overview.prevAvgEngagementTime! ? "up" : "down"}
            help="Total engaged time ÷ engaged sessions (≥10s visible/active or ≥2 page views)."
          />
          <StatCard
            title="Engagement rate"
            value={formatPercent(overview.engagementRate)}
            delta={
              overview.prevEngagementRate !== null
                ? `${(overview.engagementRate ?? 0 - overview.prevEngagementRate).toFixed(1)} pts`
                : "—"
            }
            trend={
              overview.prevEngagementRate === null ? null : (overview.engagementRate ?? 0) > overview.prevEngagementRate ? "up" : "down"
            }
            help="Engaged sessions ÷ all sessions."
          />
          <StatCard
            title="Bounce rate"
            value={formatPercent(overview.bounceRate)}
            delta={
              overview.prevBounceRate !== null
                ? `-${((overview.bounceRate ?? 0) - overview.prevBounceRate).toFixed(1)} pts`
                : "—"
            }
            trend={overview.prevBounceRate === null ? null : overview.bounceRate! < overview.prevBounceRate! ? "up" : "down"}
            help="Single-page-view sessions ÷ all sessions."
          />
          <StatCard
            title="Total engaged time"
            value={formatDuration(overview.totalEngagedTime)}
            help="Sum of visible, active reading time across all article sessions in the period."
          />
          <StatCard
            title="Published articles"
            value={formatCount(overview.publishedArticles)}
          />
          <StatCard
            title="Published in period"
            value={formatCount(overview.publishedInPeriod)}
            help="Articles with a publication date inside the selected period."
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
          />
        </div>
        <div className="adm-panel">
          <AreaTrendChart series={overview.series} valueKey="sessions" label="Sessions over time" />
        </div>
        <div className="adm-panel">
          <ComparisonBars
            current={{
              pageViews: overview.pageViews,
              sessions: overview.sessions,
              engagementRate: overview.engagementRate ?? 0,
              bounceRate: overview.bounceRate ?? 0,
              avgEngagementTime: overview.avgEngagementTime ?? 0,
            }}
            previous={{
              pageViews: overview.prevPageViews,
              sessions: overview.prevSessions,
              engagementRate: overview.prevEngagementRate ?? 0,
              bounceRate: overview.prevBounceRate ?? 0,
              avgEngagementTime: overview.prevAvgEngagementTime ?? 0,
            }}
            metrics={[
              { key: "pageViews", label: "Page views", format: formatter },
              { key: "sessions", label: "Sessions", format: formatter },
              { key: "engagementRate", label: "Engagement rate (%)", format: (v) => `${v.toFixed(1)}` },
              { key: "bounceRate", label: "Bounce rate (%)", format: (v) => `${v.toFixed(1)}` },
              { key: "avgEngagementTime", label: "Avg engaged time (s)", format: (v) => `${v.toFixed(0)}` },
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
          <div className="adm-panel adm-panel--tall">
            <HistogramChart buckets={distribution.buckets} />
          </div>
          <div className="adm-panel">
            <div className="adm-panel__body">
              <h3>Reading-time statistics</h3>
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
            Searchable, sortable ranking of published articles. Sorting is editorial: views, engagement,
            completion and growth all count — not views alone.
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
            <a href={exportUrl("articles")} className="adm-btn">
              <Download size={16} /> CSV
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
          />
        </div>
        <div className="adm-panel">
          <HorizontalBarChart
            data={topics.categories.slice(0, 10).map((c: TopicRow) => ({ name: c.label, value: c.sessions }))}
            label="Reading sessions by category"
          />
        </div>
        <div className="adm-panel">
          <DonutChart
            data={topics.categories.slice(0, 8).map((c: TopicRow) => ({ name: c.label, value: c.views }))}
            label="Share of article traffic by topic"
          />
        </div>
        <div className="adm-panel">
          <HorizontalBarChart
            data={topics.tags.slice(0, 10).map((t: { id: string; label: string; views: number; articles: number }) => ({ name: t.label, value: t.views }))}
            label="Top tags by views"
          />
        </div>
      </section>

      {/* Traffic acquisition */}
      <section className="adm-section adm-section--two-col">
        <div className="adm-panel">
          <DonutChart
            data={sources.rows.map((s: SourceRow) => ({ name: `${s.source} · ${s.medium}`, value: s.sessions }))}
            label="Sessions by source · medium"
          />
        </div>
        <div className="adm-panel">
          <HorizontalBarChart
            data={sources.referrers.map((r: { domain: string; sessions: number }) => ({ name: r.domain, value: r.sessions }))}
            label="Top referring websites"
          />
        </div>
        <div className="adm-panel">
          <DonutChart
            data={devices.rows.map((d: DeviceRow) => ({ name: d.device, value: d.sessions }))}
            label="Sessions by device"
          />
        </div>
        <div className="adm-panel">
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

      {/* Recirculation */}
      <section className="adm-section adm-section--two-col">
        <div className="adm-panel">
          <div className="adm-panel__body">
            <h3>Article recirculation</h3>
            <div className="adm-stat-grid--mini">
              <StatCard title="Sessions" value={formatCount(recirculation.sessions)} />
              <StatCard
                title="Recirculation rate"
                value={formatPercent(recirculation.recirculationRate)}
                help="Sessions reading more than one article ÷ all sessions."
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
            <h3>Publishing performance</h3>
            <HorizontalBarChart
              data={publishing.byMonth.map((m: { periodLabel: string; published: number; avgViewsFirst28Days: number | null }) => ({ name: m.periodLabel, value: m.published }))}
              label="Articles published by month"
            />
            <table className="adm-table--compact adm-mt">
              <thead>
                <tr><th>Article age</th><th className="text-right">Articles</th><th className="text-right">Avg all-time views</th></tr>
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
          {insights.length === 0 ? (
            <p className="adm-empty__body">No significant observations for this period yet.</p>
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
              <td>All-time views in the leaderboard</td>
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
              <td className="adm-status adm-status--off">Not collected</td>
              <td>No IP addresses or locations are stored, so country/region reports are unavailable by design.</td>
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
