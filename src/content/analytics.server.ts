/**
 * First-party editorial analytics for the DYPOL Blog Stats dashboard.
 *
 * Every function is read-only with respect to published content and is guarded
 * by `requireAdmin()` — there is no client path to these numbers without an
 * authenticated desk session.
 *
 * Data source: compact rollup tables populated by the article-page beacon
 * (migrations/d1/0014_analytics_rollups.sql), plus the existing cumulative
 * `article_views` counter and the article catalogue. Dates are Asia/Kolkata
 * calendar dates, the dashboard's default reporting timezone.
 *
 * When a number cannot be measured from available data it is reported as
 * `null` (with a `source` note), never fabricated.
 */

import { getSql, type Sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin.server";
import { bucketIndex, computePeriod, kolkataAddDays, type DatePreset, type Period } from "@/lib/analytics-dates";
import {
  RETURNING_WINDOW_DAYS,
  articleRecirculation,
  classifyVisitors,
  completionQualifies,
  growth,
  isEngagedRead,
  scrollFunnel,
  sessionsFromReads,
  summarize,
  type ReadRow,
  type SessionAgg,
} from "@/lib/analytics-metrics";

async function guardedSql(): Promise<Sql> {
  await requireAdmin();
  return getSql();
}

/** ------------------------------------------------------------------ */
/** Period helpers                                                     */
/** ------------------------------------------------------------------ */

export type PeriodInput = { preset?: DatePreset; from?: string; to?: string } | null;

export function resolvePeriod(input: PeriodInput): Period {
  const preset = input?.preset === "last-30" ? "last-28" : input?.preset ?? "last-28";
  const custom =
    input && (input.preset === "custom" || input.from || input.to)
      ? { from: input.from ?? "", to: input.to ?? "" }
      : undefined;
  return computePeriod(preset, custom);
}

/** ------------------------------------------------------------------ */
/** Raw rollup readers (t116: one source, one IST date key)            */
/** ------------------------------------------------------------------ */

async function readsInRange(sql: Sql, from: string, to: string): Promise<ReadRow[]> {
  const rows = await sql<ReadRow>`
    select session_id, date, article_id, page_views, engaged_seconds, completed, key_events, max_scroll
    from analytics_article_session
    where date between ${from} and ${to}
  `;
  return rows.map((r) => ({
    ...r,
    page_views: Number(r.page_views ?? 0),
    engaged_seconds: Number(r.engaged_seconds ?? 0),
    completed: Number(r.completed ?? 0),
    key_events: Number(r.key_events ?? 0),
    max_scroll: Number(r.max_scroll ?? 0),
  }));
}

type VisitorAttrs = { source: string; medium: string; referrer: string; device: string; country: string };

/** Visitor-level attributes (first-touch source, device) for visitors seen in the period. */
async function visitorAttributes(sql: Sql, from: string, to: string): Promise<Map<string, VisitorAttrs>> {
  const rows = await sql<{ session_id: string; source: string; medium: string; referrer_domain: string; device_category: string; country: string | null }>`
    select session_id, source, medium, referrer_domain, device_category, country
    from analytics_sessions
    where session_id in (select distinct session_id from analytics_article_session where date between ${from} and ${to})
  `;
  const map = new Map<string, VisitorAttrs>();
  for (const r of rows) {
    map.set(r.session_id, {
      source: r.source || "direct",
      medium: mediumFor(r.source || "direct"),
      referrer: r.referrer_domain || "",
      device: r.device_category || "desktop",
      country: (r.country || "").toUpperCase(),
    });
  }
  return map;
}

function mediumFor(source: string): string {
  switch (source) {
    case "direct": return "(none)";
    case "organic": return "organic";
    case "social": return "social";
    case "referral": return "referral";
    case "internal": return "internal";
    case "campaign": return "campaign";
    default: return source;
  }
}

function hostOf(referrer: string): string {
  if (!referrer) return "";
  try {
    return new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return referrer.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

async function allTimeViews(sql: Sql): Promise<Record<string, number>> {
  const rows = await sql<{ article_id: string; views: number }>`select article_id, views from article_views`;
  const out: Record<string, number> = {};
  for (const row of rows) out[row.article_id] = Number(row.views ?? 0);
  return out;
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  for (let i = 0; i <= periodDays(from, to); i += 1) {
    out.push(cursor);
    cursor = kolkataAddDays(cursor, 1);
  }
  return out;
}

/** ------------------------------------------------------------------ */
/** Overview                                                           */
/** ------------------------------------------------------------------ */

export type OverviewPoint = { date: string; pageViews: number; sessions: number; engagedSeconds: number; published: number };

export type OverviewData = {
  source: "first-party";
  period: Period;
  freshness: string | null;
  pageViews: number;
  sessions: number;
  users: number;
  newUsers: number;
  returningUsers: number;
  pageViewsPerSession: number | null;
  engagedSessions: number;
  engagementRate: number | null;
  bounceRate: number | null;
  avgEngagementTime: number | null;
  totalEngagedTime: number;
  publishedArticles: number;
  publishedInPeriod: number;
  prevHasData: boolean;
  prevPageViews: number;
  prevSessions: number;
  prevUsers: number;
  prevEngagementRate: number | null;
  prevBounceRate: number | null;
  prevAvgEngagementTime: number | null;
  prevTotalEngagedTime: number;
  series: OverviewPoint[];
  previousSeries: OverviewPoint[];
  notes: string[];
};

function seriesFor(rows: ReadRow[], from: string, to: string, publishedByDate: Map<string, number>): OverviewPoint[] {
  const byDate = new Map<string, { pv: number; visitors: Set<string>; secs: number }>();
  for (const r of rows) {
    let e = byDate.get(r.date);
    if (!e) { e = { pv: 0, visitors: new Set(), secs: 0 }; byDate.set(r.date, e); }
    e.pv += r.page_views;
    e.visitors.add(r.session_id);
    e.secs += r.engaged_seconds;
  }
  return daysBetween(from, to).map((date) => {
    const e = byDate.get(date);
    return {
      date,
      pageViews: e?.pv ?? 0,
      sessions: e?.visitors.size ?? 0,
      engagedSeconds: Math.round((e?.secs ?? 0) * 10) / 10,
      published: publishedByDate.get(date) ?? 0,
    };
  });
}

async function visitDatesWindow(sql: Sql, from: string, to: string): Promise<Map<string, Set<string>>> {
  const rows = await sql<{ session_id: string; date: string }>`
    select distinct session_id, date from analytics_article_session
    where date between ${kolkataAddDays(from, -(RETURNING_WINDOW_DAYS - 1))} and ${to}
  `;
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    let set = map.get(r.session_id);
    if (!set) { set = new Set(); map.set(r.session_id, set); }
    set.add(r.date);
  }
  return map;
}

export async function analyticsOverview(input: PeriodInput): Promise<OverviewData> {
  const sql = await guardedSql();
  const period = resolvePeriod(input);

  const [cur, prev, visitDates, articles, freshness] = await Promise.all([
    readsInRange(sql, period.from, period.to),
    readsInRange(sql, period.previousFrom, period.previousTo),
    visitDatesWindow(sql, period.from, period.to),
    catalogArticles(sql),
    sql<{ last_seen: string }>`select max(last_seen) as last_seen from analytics_sessions`,
  ]);
  const lastSeen = freshness[0]?.last_seen;

  const publishedByDate = new Map<string, number>();
  let publishedInPeriod = 0;
  for (const a of articles) {
    if (!a.publishedAt) continue;
    const d = kolkataDateOfZone(a.publishedAt);
    publishedByDate.set(d, (publishedByDate.get(d) ?? 0) + 1);
    if (d >= period.from && d <= period.to) publishedInPeriod += 1;
  }

  const curSum = summarize(sessionsFromReads(cur));
  const prevSum = summarize(sessionsFromReads(prev));
  const periodVisitors = new Set(cur.map((r) => r.session_id));
  // Returning = more than one visit day within 30 days (window clipped to the period end).
  const windowed = new Map<string, Set<string>>();
  for (const v of periodVisitors) windowed.set(v, visitDates.get(v) ?? new Set());
  const visitors = classifyVisitors(periodVisitors, windowed);

  return {
    source: "first-party",
    period,
    freshness: lastSeen ? `${kolkataDisplay(lastSeen)} ${kolkataTime(lastSeen)}` : null,
    pageViews: curSum.pageViews,
    sessions: curSum.sessions,
    users: visitors.users,
    newUsers: visitors.newUsers,
    returningUsers: visitors.returningUsers,
    pageViewsPerSession: curSum.pagesPerSession,
    engagedSessions: curSum.engagedSessions,
    engagementRate: curSum.engagementRate,
    bounceRate: curSum.bounceRate,
    avgEngagementTime: curSum.avgEngagedTime,
    totalEngagedTime: curSum.engagedSeconds,
    publishedArticles: articles.length,
    publishedInPeriod,
    prevHasData: prev.length > 0,
    prevPageViews: prevSum.pageViews,
    prevSessions: prevSum.sessions,
    prevUsers: new Set(prev.map((r) => r.session_id)).size,
    prevEngagementRate: prevSum.engagementRate,
    prevBounceRate: prevSum.bounceRate,
    prevAvgEngagementTime: prevSum.avgEngagedTime,
    prevTotalEngagedTime: prevSum.engagedSeconds,
    series: seriesFor(cur, period.from, period.to, publishedByDate),
    previousSeries: seriesFor(prev, period.previousFrom, period.previousTo, publishedByDate),
    notes: [
      ...(cur.length === 0
        ? ["No measured traffic yet for this period — the first-party beacon records readers' article views from its deployment onward."]
        : []),
      "Session = one reader (random first-party id, no IP stored) on one IST calendar day. Users = distinct reader ids; returning = visited on more than one day within 30 days.",
      "Engaged session (GA4): ≥10s engaged, or 2+ page views, or an internal article click. Bounce rate = 100% − engagement rate.",
      "Engaged time counts only while the article tab is visible and active.",
    ],
  };
}

function periodDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function kolkataDisplay(utcIso: string): string {
  const ms = Date.parse(utcIso);
  if (Number.isNaN(ms)) return utcIso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(ms));
}

function kolkataTime(utcIso: string): string {
  const ms = Date.parse(utcIso);
  if (Number.isNaN(ms)) return utcIso;
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms))} IST`;
}

function kolkataDateOfZone(utcIso: string): string {
  const ms = Date.parse(utcIso);
  if (Number.isNaN(ms)) return "1970-01-01";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** ------------------------------------------------------------------ */
/** Article leaderboard                                                */
/** ------------------------------------------------------------------ */

export const LEADERBOARD_SORTS = [
  "title", "categoryLabel", "publishedAt", "ageDays", "views", "allTimeViews", "sessions",
  "avgEngagementTime", "engagementRate", "completionRate", "growth", "internalClicks", "recirculation",
  "first24h", "first7d",
] as const;
export type LeaderboardSortKey = (typeof LEADERBOARD_SORTS)[number];
/** Sort string: key (descending) or key + "-" (ascending). */
export type LeaderboardSort = string;

export function parseSort(sort: string | null | undefined): { key: LeaderboardSortKey; asc: boolean } {
  const raw = (sort ?? "views").trim();
  const asc = raw.endsWith("-");
  const key = raw.replace(/-$/, "") as LeaderboardSortKey;
  return LEADERBOARD_SORTS.includes(key) ? { key, asc } : { key: "views", asc: false };
}

export type LeaderboardRow = {
  id: string;
  slug: string;
  title: string;
  categoryLabel: string;
  tagLabels: string[];
  publishedAt: string | null;
  ageDays: number | null;
  views: number;
  allTimeViews: number;
  sessions: number;
  engagedSeconds: number;
  avgEngagementTime: number | null;
  engagementRate: number | null;
  completionRate: number | null;
  growth: number | null;
  growthLabel: string;
  growthRank: number;
  internalClicks: number;
  recirculation: number | null;
  first24h: number | null;
  first7d: number | null;
};

export type LeaderboardData = {
  source: "first-party";
  period: Period;
  rows: LeaderboardRow[];
  page: number;
  pageSize: number;
  total: number;
  sort: { key: LeaderboardSortKey; asc: boolean };
  notes: string[];
};

type ArticleAgg = { views: number; reads: number; sessions: Set<string>; secs: number; engagedReads: number; completions: number };

function aggregateByArticle(rows: ReadRow[]): Map<string, ArticleAgg> {
  const map = new Map<string, ArticleAgg>();
  for (const r of rows) {
    let a = map.get(r.article_id);
    if (!a) { a = { views: 0, reads: 0, sessions: new Set(), secs: 0, engagedReads: 0, completions: 0 }; map.set(r.article_id, a); }
    a.views += r.page_views;
    a.reads += 1;
    a.sessions.add(`${r.session_id}|${r.date}`);
    a.secs += r.engaged_seconds;
    if (isEngagedRead(r)) a.engagedReads += 1;
    if (completionQualifies(r)) a.completions += 1;
  }
  return map;
}

/** Views in the first 24h / 7 days after publication (IST day granularity for older rows). */
async function earlyViews(sql: Sql, articles: CatalogArticle[]): Promise<Map<string, { first24h: number; first7d: number }>> {
  const rows = await sql<{ article_id: string; date: string; views: number }>`
    select article_id, date, sum(page_views)::int as views from analytics_article_session group by article_id, date
  `;
  const pub = new Map(articles.filter((a) => a.publishedAt).map((a) => [a.id, kolkataDateOfZone(a.publishedAt!)]));
  const out = new Map<string, { first24h: number; first7d: number }>();
  for (const r of rows) {
    const p = pub.get(r.article_id);
    if (!p || r.date < p) continue;
    let e = out.get(r.article_id);
    if (!e) { e = { first24h: 0, first7d: 0 }; out.set(r.article_id, e); }
    if (r.date <= kolkataAddDays(p, 1)) e.first24h += Number(r.views ?? 0);
    if (r.date <= kolkataAddDays(p, 6)) e.first7d += Number(r.views ?? 0);
  }
  return out;
}

export async function analyticsLeaderboard(input: {
  period: PeriodInput;
  sort?: LeaderboardSort;
  categoryId?: string | null;
  tagId?: string | null;
  q?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<LeaderboardData> {
  const sql = await guardedSql();
  const period = resolvePeriod(input.period);
  const page = Math.max(1, Number(input.page ?? 1) || 1);
  const pageSize = Math.min(10000, Math.max(1, Number(input.pageSize ?? 25) || 25));
  const sort = parseSort(input.sort);

  const [cur, prev, allViews, articles, clicks] = await Promise.all([
    readsInRange(sql, period.from, period.to),
    readsInRange(sql, period.previousFrom, period.previousTo),
    allTimeViews(sql),
    catalogArticles(sql),
    internalClicksByFrom(sql, period.from, period.to),
  ]);
  const early = await earlyViews(sql, articles);
  const curAgg = aggregateByArticle(cur);
  const prevAgg = aggregateByArticle(prev);
  const beaconStart = await sql<{ d: string | null }>`select min(date) as d from analytics_article_session`;
  const measuredFrom = beaconStart[0]?.d ?? null;

  const list: LeaderboardRow[] = [];
  for (const article of articles) {
    if (input.categoryId && article.categoryId !== input.categoryId && !article.topicIds.includes(input.categoryId)) continue;
    if (input.tagId && !article.topicIds.includes(input.tagId)) continue;
    if (input.q) {
      const needle = input.q.toLowerCase();
      if (!article.title.toLowerCase().includes(needle) && !article.slug.toLowerCase().includes(needle)) continue;
    }
    const a = curAgg.get(article.id);
    const views = a?.views ?? 0;
    const reads = a?.reads ?? 0;
    const prevViews = prevAgg.get(article.id)?.views ?? 0;
    const g = growth(views, prevViews);
    const ageDays = article.publishedAt ? Math.floor((Date.now() - Date.parse(article.publishedAt)) / 86400000) : null;
    const internal = clicks.get(article.id) ?? 0;
    const pubDate = article.publishedAt ? kolkataDateOfZone(article.publishedAt) : null;
    // Early-window views only exist when the beacon was measuring on the publish day.
    const measurable = pubDate !== null && measuredFrom !== null && pubDate >= measuredFrom;
    const e = early.get(article.id);
    list.push({
      id: article.id,
      slug: article.slug,
      title: article.title,
      categoryLabel: article.categoryLabel,
      tagLabels: article.topicLabels,
      publishedAt: article.publishedAt,
      ageDays,
      views,
      allTimeViews: allViews[article.id] ?? 0,
      sessions: a?.sessions.size ?? 0,
      engagedSeconds: Math.round((a?.secs ?? 0) * 10) / 10,
      avgEngagementTime: views > 0 ? Math.round(((a?.secs ?? 0) / views) * 10) / 10 : null,
      engagementRate: reads > 0 ? Math.round(((a?.engagedReads ?? 0) / reads) * 1000) / 10 : null,
      completionRate: reads > 0 ? Math.round(((a?.completions ?? 0) / reads) * 1000) / 10 : null,
      growth: g.value,
      growthLabel: g.label,
      growthRank: g.rank,
      internalClicks: internal,
      recirculation: articleRecirculation(views, internal),
      first24h: measurable ? (e?.first24h ?? 0) : null,
      first7d: measurable ? (e?.first7d ?? 0) : null,
    });
  }

  list.sort((x, y) => compareLeaderboard(x, y, sort.key, sort.asc));
  const total = list.length;
  const offset = (page - 1) * pageSize;

  return {
    source: "first-party",
    period,
    rows: list.slice(offset, offset + pageSize),
    page,
    pageSize,
    total,
    sort,
    notes: [
      "Views, reads and engagement are first-party beacon data (bots, crawlers and previews excluded) for the selected period, in IST days.",
      "Raw hits (all-time) is the site's cumulative server counter: it counts every request, including bots and your own visits, so it is always higher.",
      "Growth: 0 → 0 shows —, a drop to 0 shows −100%, traffic with no prior-period views shows New.",
      "Avg engaged time = engaged time ÷ page views. Engagement = share of reads with ≥10s engaged, 2+ views or an internal click. Completion = reads reaching ~90% scroll with ≥15s engaged.",
      "Recirculation (per article) = share of the article's views followed by a click to another article.",
      "First 24h / 7d = views in the publication day + next day / first 7 IST days; — when the article was published before measurement started.",
    ],
  };
}

type CatalogArticle = {
  id: string; slug: string; title: string; categoryId: string; categoryLabel: string;
  publishedAt: string | null; topicIds: string[]; topicLabels: string[];
};

async function catalogArticles(sql: Sql): Promise<CatalogArticle[]> {
  const [rows, topics] = await Promise.all([
    sql<{ id: string; slug: string; title: string; categoryId: string; categoryLabel: string; publishedAt: string | null }>`
      select a.id, a.slug, a.title, a.category_id as categoryId, c.label as categoryLabel, a.published_at as publishedAt
      from articles a
      join categories c on c.id = a.category_id
      where a.status = 'published'
      order by a.title
    `,
    sql<{ article_id: string; id: string; label: string }>`
      select t.article_id, c.id, c.label from article_topics t join categories c on c.id = t.category_id
    `,
  ]);
  const byArticle = new Map<string, Array<{ id: string; label: string }>>();
  for (const t of topics) {
    let list = byArticle.get(t.article_id);
    if (!list) { list = []; byArticle.set(t.article_id, list); }
    list.push({ id: t.id, label: t.label });
  }
  return rows.map((row) => {
    const list = byArticle.get(row.id) ?? [{ id: row.categoryId, label: row.categoryLabel }];
    return { ...row, topicIds: list.map((t) => t.id), topicLabels: list.map((t) => t.label) };
  });
}

async function internalClicksByFrom(sql: Sql, from: string, to: string): Promise<Map<string, number>> {
  const rows = await sql<{ from_article_id: string; clicks: number }>`
    select from_article_id, sum(clicks)::int as clicks
    from analytics_link_clicks
    where date between ${from} and ${to}
    group by from_article_id
  `;
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.from_article_id, Number(row.clicks ?? 0));
  return map;
}

function compareLeaderboard(a: LeaderboardRow, b: LeaderboardRow, key: LeaderboardSortKey, asc: boolean): number {
  const dir = asc ? 1 : -1;
  if (key === "title" || key === "categoryLabel") {
    return (a[key] ?? "").localeCompare(b[key] ?? "") * (asc ? 1 : -1) || a.title.localeCompare(b.title);
  }
  const get = (row: LeaderboardRow): number => {
    switch (key) {
      case "publishedAt": return row.publishedAt ? Date.parse(row.publishedAt) : -1;
      case "growth": return row.growthRank;
      default: {
        const v = row[key] as number | null;
        return v === null || v === undefined ? -1 : v;
      }
    }
  };
  const diff = (get(a) - get(b)) * dir;
  return diff !== 0 ? diff : b.views - a.views || a.title.localeCompare(b.title);
}

/** ------------------------------------------------------------------ */
/** Categories & tags (topics)                                         */
/** ------------------------------------------------------------------ */

export type TopicRow = {
  id: string;
  label: string;
  views: number;
  sessions: number;
  engagedSeconds: number;
  engagementRate: number | null;
  completionRate: number | null;
  articles: number;
  topArticle: { id: string; title: string; slug: string; views: number } | null;
};

export async function analyticsTopics(input: { period: PeriodInput }): Promise<{
  source: "first-party";
  period: Period;
  categories: TopicRow[];
  tags: Array<{ id: string; label: string; views: number; articles: number; avgEngagedTime: number | null }>;
  notes: string[];
}> {
  const sql = await guardedSql();
  const period = resolvePeriod(input.period);
  const [cur, articles] = await Promise.all([readsInRange(sql, period.from, period.to), catalogArticles(sql)]);
  const agg = aggregateByArticle(cur);

  const catMap = new Map<string, TopicRow & { reads: number; engagedReads: number; completions: number }>();
  for (const article of articles) {
    let cat = catMap.get(article.categoryId);
    if (!cat) {
      cat = { id: article.categoryId, label: article.categoryLabel, views: 0, sessions: 0, engagedSeconds: 0, engagementRate: null, completionRate: null, articles: 0, topArticle: null, reads: 0, engagedReads: 0, completions: 0 };
      catMap.set(article.categoryId, cat);
    }
    const a = agg.get(article.id);
    const views = a?.views ?? 0;
    cat.views += views;
    cat.sessions += a?.sessions.size ?? 0;
    cat.engagedSeconds += a?.secs ?? 0;
    cat.reads += a?.reads ?? 0;
    cat.engagedReads += a?.engagedReads ?? 0;
    cat.completions += a?.completions ?? 0;
    cat.articles += 1;
    if (!cat.topArticle || views > cat.topArticle.views) cat.topArticle = { id: article.id, title: article.title, slug: article.slug, views };
  }
  for (const cat of catMap.values()) {
    cat.engagementRate = cat.reads > 0 ? Math.round((cat.engagedReads / cat.reads) * 1000) / 10 : null;
    cat.completionRate = cat.reads > 0 ? Math.round((cat.completions / cat.reads) * 1000) / 10 : null;
    cat.engagedSeconds = Math.round(cat.engagedSeconds * 10) / 10;
  }

  const tagMap = new Map<string, { label: string; views: number; secs: number; articles: Set<string> }>();
  for (const article of articles) {
    article.topicIds.forEach((id, i) => {
      let e = tagMap.get(id);
      if (!e) { e = { label: article.topicLabels[i], views: 0, secs: 0, articles: new Set() }; tagMap.set(id, e); }
      const a = agg.get(article.id);
      e.views += a?.views ?? 0;
      e.secs += a?.secs ?? 0;
      e.articles.add(article.id);
    });
  }

  return {
    source: "first-party",
    period,
    categories: Array.from(catMap.values()).map(({ reads: _r, engagedReads: _e, completions: _c, ...rest }) => rest).sort((a, b) => b.views - a.views),
    tags: Array.from(tagMap.entries())
      .map(([id, e]) => ({ id, label: e.label, views: e.views, articles: e.articles.size, avgEngagedTime: e.views > 0 ? Math.round((e.secs / e.views) * 10) / 10 : null }))
      .sort((a, b) => b.views - a.views),
    notes: [
      "Category = each article's primary topic. Tags = every topic an article is filed under, so tag totals add up to more than the site total.",
    ],
  };
}

/** ------------------------------------------------------------------ */
/** Traffic sources & devices (beacon visitor attributes)              */
/** ------------------------------------------------------------------ */

export type SourceRow = {
  source: string;
  medium: string;
  sessions: number;
  pageViews: number;
  engagementRate: number | null;
  avgEngagementTime: number | null;
  viewsPerSession: number | null;
};

type Bucket = { sessions: SessionAgg[] };

function sessionsByAttr(cur: ReadRow[], attrs: Map<string, VisitorAttrs>, pick: (a: VisitorAttrs) => string): Map<string, Bucket> {
  const out = new Map<string, Bucket>();
  for (const s of sessionsFromReads(cur)) {
    const a = attrs.get(s.visitor) ?? { source: "direct", medium: "(none)", referrer: "", device: "desktop", country: "" };
    const key = pick(a);
    let b = out.get(key);
    if (!b) { b = { sessions: [] }; out.set(key, b); }
    b.sessions.push(s);
  }
  return out;
}

export async function analyticsSources(input: { period: PeriodInput }): Promise<{
  source: "first-party";
  period: Period;
  rows: SourceRow[];
  referrers: Array<{ domain: string; sessions: number }>;
  organicShare: number | null;
  notes: string[];
}> {
  const sql = await guardedSql();
  const period = resolvePeriod(input.period);
  const [cur, attrs] = await Promise.all([readsInRange(sql, period.from, period.to), visitorAttributes(sql, period.from, period.to)]);
  const groups = sessionsByAttr(cur, attrs, (a) => `${a.source}|${a.medium}`);
  const rows: SourceRow[] = [];
  let organic = 0;
  let total = 0;
  for (const [key, b] of groups) {
    const [source, medium] = key.split("|");
    const sum = summarize(b.sessions);
    rows.push({ source, medium, sessions: sum.sessions, pageViews: sum.pageViews, engagementRate: sum.engagementRate, avgEngagementTime: sum.avgEngagedTime, viewsPerSession: sum.pagesPerSession });
    total += sum.sessions;
    if (source === "organic") organic += sum.sessions;
  }
  const refGroups = sessionsByAttr(cur, attrs, (a) => (a.source === "internal" ? "" : hostOf(a.referrer)));
  const referrers = Array.from(refGroups.entries())
    .filter(([domain]) => domain)
    .map(([domain, b]) => ({ domain, sessions: b.sessions.length }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 10);
  return {
    source: "first-party",
    period,
    rows: rows.sort((a, b) => b.sessions - a.sessions),
    referrers,
    organicShare: total > 0 ? Math.round((organic / total) * 1000) / 10 : null,
    notes: [
      "Source is the reader's first-touch referrer (UTM-tagged arrivals = campaign); a missing referrer is reported as direct.",
    ],
  };
}

export type DeviceRow = {
  device: string;
  sessions: number;
  pageViews: number;
  engagementRate: number | null;
  avgEngagementTime: number | null;
};

export async function analyticsDevices(input: { period: PeriodInput }): Promise<{
  source: "first-party";
  period: Period;
  rows: DeviceRow[];
  countries: Array<{ country: string; sessions: number; pageViews: number }>;
  notes: string[];
}> {
  const sql = await guardedSql();
  const period = resolvePeriod(input.period);
  const [cur, attrs] = await Promise.all([readsInRange(sql, period.from, period.to), visitorAttributes(sql, period.from, period.to)]);
  const rows = Array.from(sessionsByAttr(cur, attrs, (a) => a.device).entries()).map(([device, b]) => {
    const sum = summarize(b.sessions);
    return { device, sessions: sum.sessions, pageViews: sum.pageViews, engagementRate: sum.engagementRate, avgEngagementTime: sum.avgEngagedTime };
  });
  const countries = Array.from(sessionsByAttr(cur, attrs, (a) => a.country || "").entries())
    .filter(([c]) => c)
    .map(([country, b]) => ({ country, sessions: b.sessions.length, pageViews: b.sessions.reduce((n, s) => n + s.pageViews, 0) }))
    .sort((a, b) => b.sessions - a.sessions);
  return {
    source: "first-party",
    period,
    rows: rows.sort((a, b) => b.sessions - a.sessions),
    countries,
    notes: ["Device category is derived from the browser's user-agent string and is approximate."],
  };
}

/** ------------------------------------------------------------------ */
/** Engagement distribution (histogram)                                */
/** ------------------------------------------------------------------ */

export type DistributionStats = {
  count: number;
  average: number | null;
  median: number | null;
  p75: number | null;
  p90: number | null;
};

export async function analyticsEngagementDistribution(input: {
  period: PeriodInput;
  articleId?: string | null;
}): Promise<{
  source: "first-party";
  period: Period;
  buckets: Array<{ label: string; count: number; seconds: number }>;
  stats: DistributionStats | null;
  notes: string[];
}> {
  const sql = await guardedSql();
  const period = resolvePeriod(input.period);
  const rows = (await readsInRange(sql, period.from, period.to)).filter((r) => !input.articleId || r.article_id === input.articleId);
  const values = rows.map((r) => r.engaged_seconds).sort((a, b) => a - b);
  const stats = values.length > 0 ? {
    count: values.length,
    average: values.reduce((a, b) => a + b, 0) / values.length,
    median: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p90: percentile(values, 0.9),
  } : null;
  return {
    source: "first-party",
    period,
    buckets: computeBuckets(values),
    stats,
    notes: [
      "Each value is one reader's engaged time with one article on one day (visible, active time only).",
      stats ? `Exact median and percentiles over ${values.length} reads.` : "No engagement records yet for this period.",
    ],
  };
}

function computeBuckets(values: number[]): Array<{ label: string; count: number; seconds: number }> {
  const counts = new Array(7).fill(0);
  for (const v of values) {
    const i = bucketIndex(v);
    if (i >= 0) counts[i] += 1;
  }
  const labels = ["Under 10s", "10–30s", "30–60s", "1–3 min", "3–5 min", "5–10 min", "Over 10 min"];
  return labels.map((label, i) => ({ label, count: counts[i], seconds: 0 }));
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = p * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/** ------------------------------------------------------------------ */
/** Recirculation                                                      */
/** ------------------------------------------------------------------ */

export async function analyticsRecirculation(input: { period: PeriodInput }): Promise<{
  source: "first-party";
  period: Period;
  sessions: number;
  multiArticleSessions: number;
  multiArticleRate: number | null;
  avgArticlesPerSession: number | null;
  pageViews: number;
  internalClicks: number;
  clickThroughRate: number | null;
  topLinks: Array<{ fromTitle: string; toTitle: string; clicks: number }>;
  notes: string[];
}> {
  const sql = await guardedSql();
  const period = resolvePeriod(input.period);
  const [cur, articles, clicks] = await Promise.all([
    readsInRange(sql, period.from, period.to),
    catalogArticles(sql),
    sql<{ from_article_id: string; to_article_id: string; clicks: number }>`
      select from_article_id, to_article_id, sum(clicks)::int as clicks
      from analytics_link_clicks
      where date between ${period.from} and ${period.to}
      group by from_article_id, to_article_id
      order by clicks desc
    `,
  ]);
  const titles = new Map(articles.map((a) => [a.id, a.title]));
  const sessions = sessionsFromReads(cur);
  const multi = sessions.filter((s) => s.articles > 1).length;
  const pageViews = cur.reduce((n, r) => n + r.page_views, 0);
  const internalClicks = clicks.reduce((n, c) => n + Number(c.clicks ?? 0), 0);
  return {
    source: "first-party",
    period,
    sessions: sessions.length,
    multiArticleSessions: multi,
    multiArticleRate: sessions.length > 0 ? Math.round((multi / sessions.length) * 1000) / 10 : null,
    avgArticlesPerSession: sessions.length > 0 ? Math.round((sessions.reduce((n, s) => n + s.articles, 0) / sessions.length) * 100) / 100 : null,
    pageViews,
    internalClicks,
    clickThroughRate: articleRecirculation(pageViews, internalClicks),
    topLinks: clicks.slice(0, 10).map((c) => ({
      fromTitle: titles.get(c.from_article_id) ?? c.from_article_id,
      toTitle: titles.get(c.to_article_id) ?? c.to_article_id,
      clicks: Number(c.clicks ?? 0),
    })),
    notes: [
      "Recirculation (Parse.ly style) = internal article clicks ÷ article page views, site-wide; the per-article figure is in the leaderboard.",
      "Multi-article sessions (site-level) = sessions that read 2+ different articles in one IST day, by any route (menu, home, back button).",
    ],
  };
}

/** ------------------------------------------------------------------ */
/** Publishing performance                                             */
/** ------------------------------------------------------------------ */

export async function analyticsPublishing(input: { period: PeriodInput }): Promise<{
  source: "first-party";
  period: Period;
  byMonth: Array<{ periodLabel: string; published: number; avgViewsFirst28Days: number | null }>;
  ageCohorts: Array<{ label: string; articles: number; avgViews: number | null }>;
  notes: string[];
}> {
  const sql = await guardedSql();
  const period = resolvePeriod(input.period);
  const articles = await catalogArticles(sql);
  const daily = await sql<{ article_id: string; date: string; views: number }>`
    select article_id, date, sum(page_views)::int as views from analytics_article_session group by article_id, date
  `;
  const pub = new Map(articles.filter((a) => a.publishedAt).map((a) => [a.id, kolkataDateOfZone(a.publishedAt!)]));
  const first28: Record<string, number> = {};
  const measured: Record<string, number> = {};
  for (const r of daily) {
    const p = pub.get(r.article_id);
    if (!p) continue;
    measured[r.article_id] = (measured[r.article_id] ?? 0) + Number(r.views ?? 0);
    if (r.date >= p && r.date <= kolkataAddDays(p, 27)) first28[r.article_id] = (first28[r.article_id] ?? 0) + Number(r.views ?? 0);
  }

  const byMonthMap = new Map<string, string[]>();
  const now = Date.now();
  const ageBuckets: { label: string; min: number; max: number | null; articles: number; views: number }[] = [
    { label: "Under 7 days", min: 0, max: 7, articles: 0, views: 0 },
    { label: "1 week – 1 month", min: 7, max: 30, articles: 0, views: 0 },
    { label: "1–6 months", min: 30, max: 180, articles: 0, views: 0 },
    { label: "Over 6 months", min: 180, max: null, articles: 0, views: 0 },
  ];
  for (const article of articles) {
    if (!article.publishedAt) continue;
    const pubDate = kolkataDateOfZone(article.publishedAt);
    const age = Math.floor((now - Date.parse(article.publishedAt)) / 86400000);
    const bucket = ageBuckets.find((b) => age >= b.min && (b.max === null || age < b.max));
    if (bucket) { bucket.articles += 1; bucket.views += measured[article.id] ?? 0; }
    if (pubDate < period.from || pubDate > period.to) continue;
    const month = pubDate.slice(0, 7);
    const list = byMonthMap.get(month) ?? [];
    list.push(article.id);
    byMonthMap.set(month, list);
  }

  const byMonth: Array<{ periodLabel: string; published: number; avgViewsFirst28Days: number | null }> = [];
  let cursor = period.from.slice(0, 7);
  const endMonth = period.to.slice(0, 7);
  for (let guard = 0; guard < 24; guard += 1) {
    const ids = byMonthMap.get(cursor) ?? [];
    byMonth.push({
      periodLabel: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short", year: "numeric" }).format(new Date(`${cursor}-01T00:00:00Z`)),
      published: ids.length,
      avgViewsFirst28Days: ids.length > 0 ? Math.round((ids.reduce((sum, id) => sum + (first28[id] ?? 0), 0) / ids.length) * 10) / 10 : null,
    });
    if (cursor === endMonth) break;
    const [y, m] = cursor.split("-").map(Number);
    cursor = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  }

  return {
    source: "first-party",
    period,
    byMonth,
    ageCohorts: ageBuckets.map((b) => ({ label: b.label, articles: b.articles, avgViews: b.articles > 0 ? Math.round((b.views / b.articles) * 10) / 10 : null })),
    notes: [
      "Months are by IST publication date. First 28 days = beacon views from the publication day to day 28.",
      "Age cohorts use beacon-measured views (bots excluded); compare within a cohort, not across.",
    ],
  };
}

/** ------------------------------------------------------------------ */
/** CSV export                                                         */
/** ------------------------------------------------------------------ */

export async function analyticsExportCsv(input: {
  table: "articles" | "categories" | "sources" | "devices" | "overview";
  period: PeriodInput;
  categoryId?: string | null;
  tagId?: string | null;
  q?: string | null;
}): Promise<{ csv: string; filename: string }> {
  const period = resolvePeriod(input.period);
  const stamp = new Date().toISOString().slice(0, 10);

  if (input.table === "articles") {
    const data = await analyticsLeaderboard({
      period: input.period, page: 1, pageSize: 10000,
      categoryId: input.categoryId, tagId: input.tagId, q: input.q,
    });
    const lines = ["Article,Slug,Category,Tags,Published,Age (days),Page views,Raw hits (all-time),Sessions,Avg engaged time (s),Engagement rate (%),Completion rate (%),Growth,Internal clicks,Recirculation (%),First 24h views,First 7d views"];
    for (const row of data.rows) {
      lines.push([
        csvEscape(row.title), csvEscape(row.slug), csvEscape(row.categoryLabel), csvEscape(row.tagLabels.join("; ")),
        row.publishedAt ?? "", row.ageDays ?? "", row.views, row.allTimeViews, row.sessions,
        row.avgEngagementTime ?? "", row.engagementRate ?? "", row.completionRate ?? "", csvEscape(row.growthLabel),
        row.internalClicks, row.recirculation ?? "", row.first24h ?? "", row.first7d ?? "",
      ].join(","));
    }
    return { csv: lines.join("\n") + "\n", filename: `dypol-articles-${period.from}-to-${period.to}-${stamp}.csv` };
  }

  if (input.table === "overview") {
    const o = await analyticsOverview(input.period);
    const lines = [
      "Metric,This period,Previous period",
      `Period,${o.period.from} to ${o.period.to},${o.period.previousFrom} to ${o.period.previousTo}`,
      `Page views,${o.pageViews},${o.prevHasData ? o.prevPageViews : ""}`,
      `Sessions,${o.sessions},${o.prevHasData ? o.prevSessions : ""}`,
      `Users,${o.users},${o.prevHasData ? o.prevUsers : ""}`,
      `New users,${o.newUsers},`,
      `Returning users,${o.returningUsers},`,
      `Engagement rate (%),${o.engagementRate ?? ""},${o.prevEngagementRate ?? ""}`,
      `Bounce rate (%),${o.bounceRate ?? ""},${o.prevBounceRate ?? ""}`,
      `Avg engaged time (s),${o.avgEngagementTime ?? ""},${o.prevAvgEngagementTime ?? ""}`,
      `Total engaged time (s),${o.totalEngagedTime},${o.prevHasData ? o.prevTotalEngagedTime : ""}`,
      `Published in period,${o.publishedInPeriod},`,
      "",
      "Date,Page views,Sessions,Engaged seconds,Published",
      ...o.series.map((p) => `${p.date},${p.pageViews},${p.sessions},${p.engagedSeconds},${p.published}`),
    ];
    return { csv: lines.join("\n") + "\n", filename: `dypol-overview-${period.from}-to-${period.to}-${stamp}.csv` };
  }

  if (input.table === "categories") {
    const data = await analyticsTopics({ period: input.period });
    const lines = ["Category,Page views,Sessions,Engaged seconds,Articles"];
    for (const row of data.categories) {
      lines.push([csvEscape(row.label), row.views, row.sessions, Math.round(row.engagedSeconds), row.articles].join(","));
    }
    return { csv: lines.join("\n") + "\n", filename: `dypol-categories-${period.from}-to-${period.to}-${stamp}.csv` };
  }

  if (input.table === "sources") {
    const data = await analyticsSources({ period: input.period });
    const lines = ["Source,Medium,Sessions,Page views,Engagement rate (%),Avg engagement time (s),Views per session"];
    for (const row of data.rows) {
      lines.push([csvEscape(row.source), csvEscape(row.medium), row.sessions, row.pageViews, row.engagementRate ?? "", row.avgEngagementTime ?? "", row.viewsPerSession ?? ""].join(","));
    }
    return { csv: lines.join("\n") + "\n", filename: `dypol-sources-${period.from}-to-${period.to}-${stamp}.csv` };
  }

  const data = await analyticsDevices({ period: input.period });
  const lines = ["Device,Sessions,Page views,Engagement rate (%),Avg engagement time (s)"];
  for (const row of data.rows) {
    lines.push([csvEscape(row.device), row.sessions, row.pageViews, row.engagementRate ?? "", row.avgEngagementTime ?? ""].join(","));
  }
  return { csv: lines.join("\n") + "\n", filename: `dypol-devices-${period.from}-to-${period.to}-${stamp}.csv` };
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"` + text.replace(/"/g, '""') + `"`;
  return text;
}

/** ------------------------------------------------------------------ */
/** t116 PR 2: scroll funnel, entry/exit, search terms, annotations     */
/** ------------------------------------------------------------------ */

export type PageCount = { id: string; title: string; slug: string; sessions: number };

function entryExit(rows: Array<{ session_id: string; date: string; article_id: string; first_at: string | null; last_at: string | null }>) {
  const byVisit = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.session_id}|${r.date}`;
    const list = byVisit.get(key) ?? [];
    list.push(r);
    byVisit.set(key, list);
  }
  const entries = new Map<string, number>();
  const exits = new Map<string, number>();
  for (const list of byVisit.values()) {
    const timed = list.filter((r) => r.first_at);
    if (timed.length === 0) continue;
    const first = timed.reduce((a, b) => ((a.first_at ?? "") <= (b.first_at ?? "") ? a : b));
    const last = timed.reduce((a, b) => ((a.last_at ?? "") >= (b.last_at ?? "") ? a : b));
    entries.set(first.article_id, (entries.get(first.article_id) ?? 0) + 1);
    exits.set(last.article_id, (exits.get(last.article_id) ?? 0) + 1);
  }
  return { entries, exits };
}

export async function analyticsExtras(input: { period: PeriodInput }): Promise<{
  period: Period;
  funnel: Array<{ depth: number; reads: number; share: number | null }>;
  entryPages: PageCount[];
  exitPages: PageCount[];
  searchTerms: Array<{ term: string; count: number; results: number }>;
  annotations: Array<{ id: string; date: string; note: string; kind: "manual" | "publish" }>;
  notes: string[];
}> {
  const sql = await guardedSql();
  const period = resolvePeriod(input.period);
  const [reads, timed, articles, terms, manual] = await Promise.all([
    readsInRange(sql, period.from, period.to),
    sql<{ session_id: string; date: string; article_id: string; first_at: string | null; last_at: string | null }>`
      select session_id, date, article_id, first_at, last_at from analytics_article_session
      where date between ${period.from} and ${period.to}
    `,
    catalogArticles(sql),
    sql<{ term: string; count: number; results: number }>`
      select term, sum(count)::int as count, max(results)::int as results from analytics_search_terms
      where date between ${period.from} and ${period.to}
      group by term order by count desc limit 25
    `,
    sql<{ id: string; date: string; note: string }>`
      select id, date, note from analytics_annotations where date between ${period.from} and ${period.to} order by date
    `,
  ]);
  const byId = new Map(articles.map((a) => [a.id, a]));
  const toList = (m: Map<string, number>): PageCount[] =>
    Array.from(m.entries())
      .map(([id, sessions]) => ({ id, title: byId.get(id)?.title ?? id, slug: byId.get(id)?.slug ?? "", sessions }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 10);
  const { entries, exits } = entryExit(timed);
  const publishNotes = articles
    .filter((a) => a.publishedAt)
    .map((a) => ({ id: `pub-${a.id}`, date: kolkataDateOfZone(a.publishedAt!), note: `Published: ${a.title}`, kind: "publish" as const }))
    .filter((a) => a.date >= period.from && a.date <= period.to);
  return {
    period,
    funnel: scrollFunnel(reads.map((r) => r.max_scroll ?? 0)),
    entryPages: toList(entries),
    exitPages: toList(exits),
    searchTerms: terms.map((t) => ({ term: t.term, count: Number(t.count ?? 0), results: Number(t.results ?? 0) })),
    annotations: [...publishNotes, ...manual.map((m) => ({ ...m, kind: "manual" as const }))].sort((a, b) => a.date.localeCompare(b.date)),
    notes: [
      "Scroll funnel = share of reads reaching each depth (100% = bottom of the article).",
      "Entry/exit = first/last article a reader viewed in a day (articles only; recorded from this release onward).",
      "Search terms are normalised (lower-case) and stored as daily counts only — no reader id.",
    ],
  };
}

export async function addAnnotation(date: string, note: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must be YYYY-MM-DD.");
  const text = note.trim().slice(0, 200);
  if (!text) throw new Error("Note is required.");
  const sql = await guardedSql();
  await sql`insert into analytics_annotations (id, date, note, created_at) values (${crypto.randomUUID()}, ${date}, ${text}, ${new Date().toISOString()})`;
}

export async function deleteAnnotation(id: string): Promise<void> {
  const sql = await guardedSql();
  await sql`delete from analytics_annotations where id = ${id}`;
}

/** Per-article drill-down. */
export async function analyticsArticle(input: { id: string; period: PeriodInput }) {
  const sql = await guardedSql();
  const period = resolvePeriod(input.period);
  const articles = await catalogArticles(sql);
  const article = articles.find((a) => a.id === input.id);
  if (!article) return null;
  const since = article.publishedAt ? kolkataDateOfZone(article.publishedAt) : period.from;
  const [allRows, attrs, next, early, raw] = await Promise.all([
    readsInRange(sql, since < period.from ? since : period.from, period.to),
    visitorAttributes(sql, since < period.from ? since : period.from, period.to),
    sql<{ to_article_id: string; clicks: number }>`
      select to_article_id, sum(clicks)::int as clicks from analytics_link_clicks
      where from_article_id = ${article.id} and date between ${period.from} and ${period.to}
      group by to_article_id order by clicks desc limit 10
    `,
    earlyViews(sql, articles),
    allTimeViews(sql),
  ]);
  const mine = allRows.filter((r) => r.article_id === article.id);
  const inPeriod = mine.filter((r) => r.date >= period.from && r.date <= period.to);
  const sinceRows = mine.filter((r) => r.date >= since);
  const byId = new Map(articles.map((a) => [a.id, a]));
  const daily = new Map<string, number>();
  for (const r of sinceRows) daily.set(r.date, (daily.get(r.date) ?? 0) + r.page_views);
  const sources = Array.from(sessionsByAttr(inPeriod, attrs, (a) => a.source).entries())
    .map(([source, b]) => ({ source, sessions: b.sessions.length }))
    .sort((a, b) => b.sessions - a.sessions);
  const sum = summarize(sessionsFromReads(inPeriod));
  const reads = inPeriod.length;
  return {
    period,
    article: { id: article.id, title: article.title, slug: article.slug, categoryLabel: article.categoryLabel, tagLabels: article.topicLabels, publishedAt: article.publishedAt },
    viewsInPeriod: sum.pageViews,
    viewsSincePublish: sinceRows.reduce((n, r) => n + r.page_views, 0),
    rawHits: raw[article.id] ?? 0,
    first24h: early.get(article.id)?.first24h ?? 0,
    first7d: early.get(article.id)?.first7d ?? 0,
    sessions: sum.sessions,
    avgEngagedTime: sum.avgEngagedTime,
    completionRate: reads > 0 ? Math.round((inPeriod.filter(completionQualifies).length / reads) * 1000) / 10 : null,
    series: daysBetween(since, period.to).slice(-120).map((date) => ({ date, views: daily.get(date) ?? 0 })),
    sources,
    funnel: scrollFunnel(inPeriod.map((r) => r.max_scroll ?? 0)),
    nextPages: next.map((n) => ({ id: n.to_article_id, title: byId.get(n.to_article_id)?.title ?? n.to_article_id, clicks: Number(n.clicks ?? 0) })),
  };
}

/** Weekly digest (last 7 IST days vs the 7 before) — JSON for external delivery. */
export async function analyticsDigest() {
  const period: PeriodInput = { preset: "last-7", from: "", to: "" };
  const [overview, leaderboard, sources, extras] = await Promise.all([
    analyticsOverview(period),
    analyticsLeaderboard({ period, page: 1, pageSize: 5 }),
    analyticsSources({ period }),
    analyticsExtras({ period }),
  ]);
  const o = overview;
  const pct = (cur: number, prev: number) => (o.prevHasData && prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
  const summary = [
    `DYPOL Blog — ${o.period.from} to ${o.period.to} (IST)`,
    `Page views: ${o.pageViews}${pct(o.pageViews, o.prevPageViews) !== null ? ` (${pct(o.pageViews, o.prevPageViews)}% vs previous 7 days)` : " (no prior data)"}`,
    `Sessions: ${o.sessions}; users: ${o.users} (${o.returningUsers} returning)`,
    `Engagement rate: ${o.engagementRate ?? "—"}%; avg engaged time: ${o.avgEngagementTime ?? "—"}s`,
    `Top articles: ${leaderboard.rows.filter((r) => r.views > 0).map((r) => `${r.title} (${r.views})`).join("; ") || "none"}`,
    `Top sources: ${sources.rows.slice(0, 3).map((r) => `${r.source} (${r.sessions})`).join("; ") || "none"}`,
    `Top searches: ${extras.searchTerms.slice(0, 5).map((t) => `${t.term} (${t.count})`).join("; ") || "none"}`,
  ].join("\n");
  return {
    period: o.period,
    pageViews: o.pageViews,
    prevPageViews: o.prevHasData ? o.prevPageViews : null,
    sessions: o.sessions,
    prevSessions: o.prevHasData ? o.prevSessions : null,
    users: o.users,
    returningUsers: o.returningUsers,
    engagementRate: o.engagementRate,
    avgEngagedTime: o.avgEngagementTime,
    topArticles: leaderboard.rows.filter((r) => r.views > 0).map((r) => ({ title: r.title, slug: r.slug, views: r.views, growth: r.growthLabel })),
    topSources: sources.rows.slice(0, 5).map((r) => ({ source: r.source, sessions: r.sessions })),
    topSearchTerms: extras.searchTerms.slice(0, 10),
    summary,
  };
}
