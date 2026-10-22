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
import { bucketIndex, computePeriod, type DatePreset, type Period } from "@/lib/analytics-dates";

/** Kolkata date expression for a UTC timestamp column/expression. */
function kolkataDateOf(expression: string): string {
  return `strftime('%Y-%m-%d', ${expression}, '+5 hours', '30 minutes')`;
}

async function guardedSql(): Promise<Sql> {
  await requireAdmin();
  return getSql();
}

/** ------------------------------------------------------------------ */
/** Period helpers                                                     */
/** ------------------------------------------------------------------ */

export type PeriodInput = { preset?: DatePreset; from?: string; to?: string } | null;

export function resolvePeriod(input: PeriodInput): Period {
  const preset = input?.preset ?? "last-28";
  const custom =
    input && (input.preset === "custom" || input.from || input.to)
      ? { from: input.from ?? "", to: input.to ?? "" }
      : undefined;
  return computePeriod(preset, custom);
}

/** ------------------------------------------------------------------ */
/** Raw rollup readers                                                 */
/** ------------------------------------------------------------------ */

type ArticleSessionRow = {
  article_id: string;
  page_views: number;
  engaged_seconds: number;
  engaged_sessions: number;
  completed: number;
  max_scroll: number;
};

async function articleSessionsInPeriod(
  sql: Sql,
  from: string,
  to: string,
): Promise<ArticleSessionRow[]> {
  return sql<ArticleSessionRow>`
    select article_id,
           sum(page_views)::int as page_views,
           sum(engaged_seconds)::real as engaged_seconds,
           sum(engaged_sessions)::int as engaged_sessions,
           sum(completed)::int as completed,
           max(max_scroll)::int as max_scroll
    from analytics_article_session
    where date between ${from} and ${to}
    group by article_id
  `;
}

async function sessionsInPeriod(
  sql: Sql,
  from: string,
  to: string,
): Promise<Array<{
  session_id: string;
  page_views: number;
  engaged_seconds: number;
  bounced: number;
  started_at: string;
  last_seen: string;
  source: string;
  medium: string;
  referrer_domain: string;
  device_category: string;
}>> {
  return sql`
    select session_id, page_views, engaged_seconds, bounced, started_at, last_seen,
           source, medium, referrer_domain, device_category
    from analytics_sessions
    where ${kolkataDateOf("last_seen")} between ${from} and ${to}
  `;
}

async function allTimeViews(sql: Sql): Promise<Record<string, number>> {
  const rows = await sql<{ article_id: string; views: number }>`select article_id, views from article_views`;
  const out: Record<string, number> = {};
  for (const row of rows) out[row.article_id] = Number(row.views ?? 0);
  return out;
}

/** ------------------------------------------------------------------ */
/** Overview                                                           */
/** ------------------------------------------------------------------ */

export type OverviewPoint = { date: string; pageViews: number; sessions: number; engagedSeconds: number };

export type OverviewData = {
  source: "first-party";
  period: Period;
  freshness: string | null;
  pageViews: number;
  sessions: number;
  users: number | null;
  newUsers: number | null;
  returningUsers: number | null;
  sessionsPerUser: number | null;
  pageViewsPerSession: number | null;
  engagedSessions: number;
  engagementRate: number | null;
  bounceRate: number | null;
  avgEngagementTime: number | null;
  avgEngagementTimePerSession: number | null;
  totalEngagedTime: number;
  publishedArticles: number;
  publishedInPeriod: number;
  prevPageViews: number;
  prevSessions: number;
  prevEngagementRate: number | null;
  prevBounceRate: number | null;
  prevAvgEngagementTime: number | null;
  prevTotalEngagedTime: number;
  series: OverviewPoint[];
  previousSeries: OverviewPoint[];
  notes: string[];
};

export async function analyticsOverview(input: PeriodInput): Promise<OverviewData> {
  const sql = await guardedSql();
  const period = resolvePeriod(input);

  const [current, previous] = await Promise.all([
    aggregatePeriod(sql, period.from, period.to),
    aggregatePeriod(sql, period.previousFrom, period.previousTo),
  ]);

  const freshness = await sql<{ last_seen: string }>`
    select max(last_seen) as last_seen from analytics_sessions
  `;
  const lastSeen = freshness[0]?.last_seen;
  const publishedRows = await sql<{ n: number }>`select count(*)::int as n from articles where status = 'published'`;
  const publishedArticles = Number(publishedRows[0]?.n ?? 0);
  const publishedInPeriod = await sql<{ n: number }>`
    select count(*)::int as n from articles
    where status = 'published' and ${kolkataDateOf("published_at")} between ${period.from} and ${period.to}
  `;

  const users = current.sessions; // session-based estimate
  const newUsers = current.newSessions;
  const returningUsers = current.returningSessions;

  const engagementRate = current.sessions > 0 ? (current.engagedSessions / current.sessions) * 100 : null;
  const bounceRate = current.sessions > 0 ? (current.bouncedSessions / current.sessions) * 100 : null;
  const avgEngagementTime = current.engagedSessions > 0 ? current.totalEngagedTime / current.engagedSessions : null;
  const avgEngagementTimePerSession = current.sessions > 0 ? current.totalEngagedTime / current.sessions : null;
  const pageViewsPerSession = current.sessions > 0 ? current.pageViews / current.sessions : null;
  const sessionsPerUser = users && users > 0 ? current.sessions / users : null;

  const prevEngagementRate =
    previous.sessions > 0 ? (previous.engagedSessions / previous.sessions) * 100 : null;
  const prevBounceRate =
    previous.sessions > 0 ? (previous.bouncedSessions / previous.sessions) * 100 : null;
  const prevAvgEngagementTime =
    previous.engagedSessions > 0 ? previous.totalEngagedTime / previous.engagedSessions : null;

  return {
    source: "first-party",
    period,
    freshness: lastSeen ? `${kolkataDisplay(lastSeen)} ${kolkataTime(lastSeen)} IST` : null,
    pageViews: current.pageViews,
    sessions: current.sessions,
    users,
    newUsers,
    returningUsers,
    sessionsPerUser,
    pageViewsPerSession,
    engagedSessions: current.engagedSessions,
    engagementRate,
    bounceRate,
    avgEngagementTime,
    avgEngagementTimePerSession,
    totalEngagedTime: current.totalEngagedTime,
    publishedArticles,
    publishedInPeriod: Number(publishedInPeriod[0]?.n ?? 0),
    prevPageViews: previous.pageViews,
    prevSessions: previous.sessions,
    prevEngagementRate,
    prevBounceRate,
    prevAvgEngagementTime,
    prevTotalEngagedTime: previous.totalEngagedTime,
    series: current.series,
    previousSeries: previous.series,
    notes: [
      ...(current.series.length === 0 || current.pageViews === 0
        ? ["No measured traffic yet for this period — the first-party beacon starts recording on readers' first article view after this feature is deployed."]
        : []),
      "Users and sessions are first-party session estimates from a 30-day cookie; they are not a census of real people.",
      "Engaged time counts only when the article tab is visible and active; abandoned background tabs do not inflate it.",
      "GA4 (G-T1R0QJ2F0Z) is installed on the site, but its reporting API is not connected to this dashboard.",
    ],
  };
}

type PeriodAggregate = {
  pageViews: number;
  sessions: number;
  newSessions: number;
  returningSessions: number;
  engagedSessions: number;
  bouncedSessions: number;
  totalEngagedTime: number;
  series: OverviewPoint[];
};

async function aggregatePeriod(sql: Sql, from: string, to: string): Promise<PeriodAggregate> {
  const rows = await sql<{
    date: string;
    page_views: number;
    sessions: number;
    engaged_seconds: number;
  }>`
    select date,
           sum(page_views)::int as page_views,
           count(distinct session_id)::int as sessions,
           sum(engaged_seconds)::real as engaged_seconds
    from analytics_article_session
    where date between ${from} and ${to}
    group by date
    order by date
  `;
  const sessionRows = await sessionsInPeriod(sql, from, to);

  const byDate = new Map<string, OverviewPoint>();
  for (const row of rows) {
    byDate.set(row.date, {
      date: row.date,
      pageViews: Number(row.page_views ?? 0),
      sessions: Number(row.sessions ?? 0),
      engagedSeconds: Number(row.engaged_seconds ?? 0),
    });
  }
  const series: OverviewPoint[] = [];
  let cursor = from;
  const span = periodDays(from, to);
  for (let i = 0; i <= span; i += 1) {
    series.push(byDate.get(cursor) ?? { date: cursor, pageViews: 0, sessions: 0, engagedSeconds: 0 });
    cursor = addKolkataDays(cursor, 1);
  }

  let engagedSessions = 0;
  let bouncedSessions = 0;
  let totalEngagedTime = 0;
  let newSessions = 0;
  let returningSessions = 0;
  for (const s of sessionRows) {
    totalEngagedTime += Number(s.engaged_seconds ?? 0);
    const startedInPeriod = kolkataDateOfZone(s.started_at) >= from && kolkataDateOfZone(s.started_at) <= to;
    if (startedInPeriod) newSessions += 1;
    else returningSessions += 1;
    const engaged = Number(s.engaged_seconds ?? 0) >= 10 || Number(s.page_views ?? 0) >= 2;
    if (engaged) engagedSessions += 1;
    if (Number(s.page_views ?? 0) <= 1) bouncedSessions += 1;
  }

  return {
    pageViews: series.reduce((sum, p) => sum + p.pageViews, 0),
    sessions: sessionRows.length,
    newSessions,
    returningSessions,
    engagedSessions,
    bouncedSessions,
    totalEngagedTime: Math.round(totalEngagedTime * 10) / 10,
    series,
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
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(ms));
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

function addKolkataDays(yyyymmdd: string, days: number): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const ms = new Date(Date.UTC(y, m - 1, d + days)).getTime();
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

export type LeaderboardSort = "views" | "engagedTime" | "completionRate" | "growth" | "published" | "title";

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
  users: number | null;
  engagedSeconds: number;
  avgEngagementTime: number | null;
  engagementRate: number | null;
  completionRate: number | null;
  growth: number | null;
  internalClicks: number;
};

export type LeaderboardData = {
  source: "first-party";
  period: Period;
  rows: LeaderboardRow[];
  page: number;
  pageSize: number;
  total: number;
  notes: string[];
};

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
  const page = Math.max(1, Number(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(input.pageSize ?? 25)));
  const offset = (page - 1) * pageSize;

  const [current, previous, allViews, articles, tags] = await Promise.all([
    articleSessionsInPeriod(sql, period.from, period.to),
    articleSessionsInPeriod(sql, period.previousFrom, period.previousTo),
    allTimeViews(sql),
    catalogArticles(sql),
    catalogTags(sql),
  ]);

  return buildLeaderboard({
    sql,
    period,
    page,
    pageSize,
    offset,
    current,
    previous,
    allViews,
    articles,
    tags,
    categoryId: input.categoryId ?? null,
    tagId: input.tagId ?? null,
    q: input.q ?? null,
    sort: input.sort ?? "views",
  });
}

async function buildLeaderboard(input: {
  sql: Sql;
  period: Period;
  page: number;
  pageSize: number;
  offset: number;
  current: ArticleSessionRow[];
  previous: ArticleSessionRow[];
  allViews: Record<string, number>;
  articles: Array<{
    id: string; slug: string; title: string; categoryId: string; categoryLabel: string;
    publishedAt: string | null; tagIds: string[];
  }>;
  tags: Array<{ id: string; label: string }>;
  categoryId: string | null;
  tagId: string | null;
  q: string | null;
  sort: LeaderboardSort;
}): Promise<LeaderboardData> {
  const { sql, period, articles, tags, current, previous, allViews, categoryId, tagId, q, sort, page, pageSize, offset } = input;
  const tagLabelsById = new Map(tags.map((t) => [t.id, t.label]));

  const byArticle = new Map<string, ArticleSessionRow>();
  for (const row of current) byArticle.set(row.article_id, row);
  const prevByArticle = new Map<string, number>();
  for (const row of previous) prevByArticle.set(row.article_id, Number(row.page_views ?? 0));

  const sessionsByArticle = await distinctSessionsPerArticle(sql, period.from, period.to);

  const list: LeaderboardRow[] = [];
  for (const article of articles) {
    if (categoryId && article.categoryId !== categoryId) continue;
    if (tagId && !article.tagIds.includes(tagId)) continue;
    if (q) {
      const needle = q.toLowerCase();
      if (!article.title.toLowerCase().includes(needle) && !article.slug.toLowerCase().includes(needle)) continue;
    }
    const agg = byArticle.get(article.id);
    const views = agg ? Number(agg.page_views ?? 0) : 0;
    const sessions = sessionsByArticle.get(article.id) ?? 0;
    const engagedSeconds = agg ? Number(agg.engaged_seconds ?? 0) : 0;
    const engagedSessions = agg ? Number(agg.engaged_sessions ?? 0) : 0;
    const completed = agg ? Number(agg.completed ?? 0) : 0;
    const prevViews = prevByArticle.get(article.id) ?? 0;
    const publishedAt = article.publishedAt;
    const ageDays = publishedAt ? Math.round((Date.now() - Date.parse(publishedAt)) / 86400000) : null;
    list.push({
      id: article.id,
      slug: article.slug,
      title: article.title,
      categoryLabel: article.categoryLabel,
      tagLabels: article.tagIds
        .map((id) => tagLabelsById.get(id))
        .filter((label): label is string => label !== undefined),
      publishedAt,
      ageDays,
      views,
      allTimeViews: allViews[article.id] ?? 0,
      sessions,
      users: null,
      engagedSeconds,
      avgEngagementTime: sessions > 0 ? Math.round((engagedSeconds / sessions) * 10) / 10 : null,
      engagementRate: sessions > 0 ? Math.round((engagedSessions / sessions) * 1000) / 10 : null,
      completionRate: views > 0 ? Math.round((completed / views) * 1000) / 10 : null,
      growth: percentChangeSafe(views, prevViews),
      internalClicks: 0,
    });
  }

  const clicks = await internalClicksByFrom(sql, period.from, period.to);
  for (const row of list) row.internalClicks = clicks.get(row.id) ?? 0;

  list.sort((a, b) => compareLeaderboard(a, b, sort));

  const total = list.length;
  const pageRows = list.slice(offset, offset + pageSize);

  return {
    source: "first-party",
    period,
    rows: pageRows,
    page,
    pageSize,
    total,
    notes: [
      "Views are first-party beacon counts for the selected period; all-time views come from the site's cumulative counter.",
      "Growth compares the period with the previous equivalent period; null means no measurable prior-period traffic.",
      "Engagement rate is the share of reading sessions with at least 10 seconds of engaged time.",
      "Completion rate is the share of page views that reached roughly 90% scroll depth.",
    ],
  };
}

async function catalogArticles(sql: Sql): Promise<Array<{
  id: string; slug: string; title: string; categoryId: string; categoryLabel: string;
  publishedAt: string | null; tagIds: string[];
}>> {
  const rows = await sql<{
    id: string; slug: string; title: string; categoryId: string; categoryLabel: string;
    publishedAt: string | null; tagIds: string;
  }>`
    select a.id, a.slug, a.title, a.category_id as categoryId, c.label as categoryLabel,
           a.published_at as publishedAt,
           coalesce(group_concat(t.tag_id), '') as tagIds
    from articles a
    join categories c on c.id = a.category_id
    left join article_tags t on t.article_id = a.id
    where a.status = 'published'
    group by a.id, a.slug, a.title, a.category_id, c.label, a.published_at
    order by a.title
  `;
  return rows.map((row) => ({
    ...row,
    tagIds: row.tagIds.split(",").filter(Boolean),
  }));
}

async function catalogTags(sql: Sql): Promise<Array<{ id: string; label: string }>> {
  return sql<{ id: string; label: string }>`select id, label from tags order by label`;
}

async function distinctSessionsPerArticle(
  sql: Sql,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const rows = await sql<{ article_id: string; n: number }>`
    select article_id, count(distinct session_id)::int as n
    from analytics_article_session
    where date between ${from} and ${to}
    group by article_id
  `;
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.article_id, Number(row.n ?? 0));
  return map;
}

async function internalClicksByFrom(
  sql: Sql,
  from: string,
  to: string,
): Promise<Map<string, number>> {
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

function compareLeaderboard(a: LeaderboardRow, b: LeaderboardRow, sort: LeaderboardSort): number {
  const get = (row: LeaderboardRow): number => {
    switch (sort) {
      case "engagedTime": return row.engagedSeconds;
      case "completionRate": return row.completionRate ?? 0;
      case "growth": return row.growth ?? -1e9;
      case "published": return row.publishedAt ? Date.parse(row.publishedAt) : -1;
      default: return row.views;
    }
  };
  if (sort === "title") return a.title.localeCompare(b.title);
  return get(b) - get(a);
}

function percentChangeSafe(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** ------------------------------------------------------------------ */
/** Categories & tags                                                  */
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
  tags: Array<{ id: string; label: string; views: number; articles: number }>;
  notes: string[];
}> {
  const sql = await guardedSql();
  const period = resolvePeriod(input.period);
  const current = await articleSessionsInPeriod(sql, period.from, period.to);
  const articles = await catalogArticles(sql);
  const tags = await catalogTags(sql);

  const viewsByArticle = new Map<string, number>();
  const engagedSecondsByArticle = new Map<string, number>();
  const engagedSessionsByArticle = new Map<string, number>();
  const completedByArticle = new Map<string, number>();
  for (const row of current) {
    viewsByArticle.set(row.article_id, Number(row.page_views ?? 0));
    engagedSecondsByArticle.set(row.article_id, Number(row.engaged_seconds ?? 0));
    engagedSessionsByArticle.set(row.article_id, Number(row.engaged_sessions ?? 0));
    completedByArticle.set(row.article_id, Number(row.completed ?? 0));
  }
  const sessMap = await distinctSessionsPerArticle(sql, period.from, period.to);

  const catMap = new Map<string, TopicRow & { engagedSessions: number }>();
  for (const article of articles) {
    let cat = catMap.get(article.categoryId);
    if (!cat) {
      cat = {
        id: article.categoryId,
        label: article.categoryLabel,
        views: 0, sessions: 0, engagedSeconds: 0, engagedSessions: 0, engagementRate: null,
        completionRate: null, articles: 0,
        topArticle: null,
      };
      catMap.set(article.categoryId, cat);
    }
    const views = viewsByArticle.get(article.id) ?? 0;
    cat.views += views;
    cat.sessions += sessMap.get(article.id) ?? 0;
    cat.engagedSeconds += engagedSecondsByArticle.get(article.id) ?? 0;
    cat.engagedSessions += engagedSessionsByArticle.get(article.id) ?? 0;
    cat.articles += 1;
    const prev = cat.topArticle;
    if (!prev || views > prev.views) {
      cat.topArticle = { id: article.id, title: article.title, slug: article.slug, views };
    }
  }

  const tagMap = new Map<string, { views: number; articles: Set<string> }>();
  for (const article of articles) {
    for (const tagId of article.tagIds) {
      let entry = tagMap.get(tagId);
      if (!entry) { entry = { views: 0, articles: new Set() }; tagMap.set(tagId, entry); }
      entry.views += viewsByArticle.get(article.id) ?? 0;
      entry.articles.add(article.id);
    }
  }

  for (const cat of catMap.values()) {
    cat.engagementRate = cat.sessions > 0 ? Math.round((cat.engagedSessions / cat.sessions) * 1000) / 10 : null;
  }

  return {
    source: "first-party",
    period,
    categories: Array.from(catMap.values()).sort((a, b) => b.views - a.views),
    tags: Array.from(tagMap.entries())
      .map(([id, entry]) => ({ id, label: tags.find((t) => t.id === id)?.label ?? id, views: entry.views, articles: entry.articles.size }))
      .sort((a, b) => b.views - a.views),
    notes: [
      "Topic popularity is measured by first-party article page views in the period.",
      "Read engagement (time spent) is a fairer topic signal than views alone — both are shown so they are not confused.",
    ],
  };
}

/** ------------------------------------------------------------------ */
/** Traffic sources                                                    */
/** ------------------------------------------------------------------ */

export type SourceRow = {
  source: string;
  medium: string;
  sessions: number;
  pageViews: number;
  users: number | null;
  engagementRate: number | null;
  avgEngagementTime: number | null;
  viewsPerSession: number | null;
};

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
  const rows = await sessionsInPeriod(sql, period.from, period.to);

  const map = new Map<string, SourceRow & { engaged: number; engagedTime: number }>();
  for (const row of rows) {
    const key = `${row.source}|${row.medium}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        source: row.source, medium: row.medium, sessions: 0, pageViews: 0,
        users: null, engagementRate: null, avgEngagementTime: null,
        viewsPerSession: null, engaged: 0, engagedTime: 0,
      };
      map.set(key, entry);
    }
    entry.sessions += 1;
    entry.pageViews += Number(row.page_views ?? 0);
    const engaged = Number(row.engaged_seconds ?? 0) >= 10 || Number(row.page_views ?? 0) >= 2;
    if (engaged) entry.engaged += 1;
    entry.engagedTime += Number(row.engaged_seconds ?? 0);
  }
  let organicSessions = 0;
  for (const entry of map.values()) {
    entry.viewsPerSession = entry.sessions > 0 ? entry.pageViews / entry.sessions : null;
    entry.engagementRate = entry.sessions > 0 ? Math.round((entry.engaged / entry.sessions) * 1000) / 10 : null;
    entry.avgEngagementTime = entry.engaged > 0 ? Math.round((entry.engagedTime / entry.engaged) * 10) / 10 : null;
    if (entry.source === "organic") organicSessions += entry.sessions;
  }
  const totalSessions = rows.length;

  const referrers = await sql<{ domain: string; n: number }>`
    select referrer_domain as domain, count(*)::int as n
    from analytics_sessions
    where ${kolkataDateOf("last_seen")} between ${period.from} and ${period.to}
      and source = 'referral' and referrer_domain <> ''
    group by referrer_domain
    order by n desc
    limit 10
  `;

  return {
    source: "first-party",
    period,
    rows: Array.from(map.values()).sort((a, b) => b.sessions - a.sessions),
    referrers: referrers.map((r) => ({ domain: r.domain, sessions: Number(r.n ?? 0) })),
    organicShare: totalSessions > 0 ? Math.round((organicSessions / totalSessions) * 1000) / 10 : null,
    notes: [
      "Source is taken from the referrer of the session's first article view; UTM-tagged arrivals are attributed to campaign.",
      "A missing referrer is reported as 'direct' — that does not mean the URL was typed in.",
    ],
  };
}

/** ------------------------------------------------------------------ */
/** Devices                                                            */
/** ------------------------------------------------------------------ */

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
  notes: string[];
}> {
  const sql = await guardedSql();
  const period = resolvePeriod(input.period);
  const rows = await sessionsInPeriod(sql, period.from, period.to);

  const map = new Map<string, { device: string; sessions: number; pageViews: number; engaged: number; engagedTime: number }>();
  for (const row of rows) {
    let entry = map.get(row.device_category);
    if (!entry) { entry = { device: row.device_category, sessions: 0, pageViews: 0, engaged: 0, engagedTime: 0 }; map.set(row.device_category, entry); }
    entry.sessions += 1;
    entry.pageViews += Number(row.page_views ?? 0);
    const engaged = Number(row.engaged_seconds ?? 0) >= 10 || Number(row.page_views ?? 0) >= 2;
    if (engaged) entry.engaged += 1;
    entry.engagedTime += Number(row.engaged_seconds ?? 0);
  }
  return {
    source: "first-party",
    period,
    rows: Array.from(map.values()).map((e) => ({
      device: e.device,
      sessions: e.sessions,
      pageViews: e.pageViews,
      engagementRate: e.sessions > 0 ? Math.round((e.engaged / e.sessions) * 1000) / 10 : null,
      avgEngagementTime: e.engaged > 0 ? Math.round((e.engagedTime / e.engaged) * 10) / 10 : null,
    })).sort((a, b) => b.sessions - a.sessions),
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
  const rows = await sql.query(
    `select engaged_seconds from analytics_article_session
     where date between $1 and $2${input.articleId ? " and article_id = $3" : ""}
     order by engaged_seconds
     limit 200000`,
    input.articleId ? [period.from, period.to, input.articleId] : [period.from, period.to],
  );
  const values = (rows as { engaged_seconds: number }[]).map((r) => Number(r.engaged_seconds ?? 0)).sort((a, b) => a - b);
  const truncated = rows.length === 200000;

  const buckets = computeBuckets(values);
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
    buckets,
    stats,
    notes: [
      "Each value is one reader's engaged time with one article in one session (visible, active time only).",
      stats
        ? `Median and percentiles are computed exactly from the ${values.length} recorded session-article durations${truncated ? ", capped at 200,000 rows" : ""}.`
        : "No engagement records yet for this period.",
    ],
  };
}

function computeBuckets(values: number[]): Array<{ label: string; count: number; seconds: number }> {
  const counts = new Array(7).fill(0);
  for (const v of values) {
    const i = bucketIndex(v);
    if (i >= 0) counts[i] += 1;
  }
  const labels = [
    { label: "Under 10s", min: 0, max: 10 },
    { label: "10–30s", min: 10, max: 30 },
    { label: "30–60s", min: 30, max: 60 },
    { label: "1–3 min", min: 60, max: 180 },
    { label: "3–5 min", min: 180, max: 300 },
    { label: "5–10 min", min: 300, max: 600 },
    { label: "Over 10 min", min: 600, max: null },
  ];
  return labels.map((b, i) => ({ label: b.label, count: counts[i], seconds: 0 }));
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
  recirculatedSessions: number;
  recirculationRate: number | null;
  avgArticlesPerSession: number | null;
  topLinks: Array<{ fromTitle: string; toTitle: string; clicks: number }>;
  notes: string[];
}> {
  const sql = await guardedSql();
  const period = resolvePeriod(input.period);
  const rows = await sql<{ session_id: string; article_id: string }>`
    select distinct session_id, article_id
    from analytics_article_session
    where date between ${period.from} and ${period.to}
  `;
  const articles = await catalogArticles(sql);
  const titles = new Map(articles.map((a) => [a.id, a.title]));
  const articlesPerSession = new Map<string, Set<string>>();
  for (const row of rows) {
    let set = articlesPerSession.get(row.session_id);
    if (!set) { set = new Set(); articlesPerSession.set(row.session_id, set); }
    set.add(row.article_id);
  }
  let recirculated = 0;
  let totalArticleVisits = 0;
  for (const set of articlesPerSession.values()) {
    totalArticleVisits += set.size;
    if (set.size > 1) recirculated += 1;
  }
  const sessions = articlesPerSession.size;
  const clicks = await sql<{ from_article_id: string; to_article_id: string; clicks: number }>`
    select from_article_id, to_article_id, sum(clicks)::int as clicks
    from analytics_link_clicks
    where date between ${period.from} and ${period.to}
    group by from_article_id, to_article_id
    order by clicks desc
    limit 10
  `;
  return {
    source: "first-party",
    period,
    sessions,
    recirculatedSessions: recirculated,
    recirculationRate: sessions > 0 ? Math.round((recirculated / sessions) * 1000) / 10 : null,
    avgArticlesPerSession: sessions > 0 ? Math.round((totalArticleVisits / sessions) * 100) / 100 : null,
    topLinks: clicks.map((c) => ({
      fromTitle: titles.get(c.from_article_id) ?? c.from_article_id,
      toTitle: titles.get(c.to_article_id) ?? c.to_article_id,
      clicks: Number(c.clicks ?? 0),
    })),
    notes: [
      "Recirculated session = a session that read more than one article.",
      "Numerator: recirculated sessions. Denominator: all sessions in the period.",
      "Internal clicks are beacon-reported clicks on links to other DYPOL Blog articles.",
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
  const allViews = await allTimeViews(sql);

  const byMonthMap = new Map<string, { published: number; articleIds: string[] }>();
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
    const age = Math.round((now - Date.parse(article.publishedAt)) / 86400000);
    const bucket = ageBuckets.find((b) => age >= b.min && (b.max === null || age < b.max));
    if (bucket) { bucket.articles += 1; bucket.views += allViews[article.id] ?? 0; }
    if (pubDate < period.from || pubDate > period.to) continue;
    const month = pubDate.slice(0, 7);
    let entry = byMonthMap.get(month);
    if (!entry) { entry = { published: 0, articleIds: [] }; byMonthMap.set(month, entry); }
    entry.published += 1;
    entry.articleIds.push(article.id);
  }

  const first28 = await first28DayViews(sql, articles.map((a) => a.id));
  const byMonth: Array<{ periodLabel: string; published: number; avgViewsFirst28Days: number | null }> = [];
  let cursor = period.from.slice(0, 7);
  const endMonth = period.to.slice(0, 7);
  while (true) {
    const entry = byMonthMap.get(cursor);
    const ids = entry ? entry.articleIds : [];
    byMonth.push({
      periodLabel: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", month: "short", year: "numeric" }).format(new Date(`${cursor}-01T00:00:00Z`)),
      published: entry?.published ?? 0,
      avgViewsFirst28Days: ids.length > 0 ? Math.round((ids.reduce((sum, id) => sum + (first28[id] ?? 0), 0) / ids.length) * 10) / 10 : null,
    });
    if (cursor === endMonth) break;
    const [y, m] = cursor.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, 1));
    next.setUTCMonth(next.getUTCMonth() + 1);
    cursor = next.toISOString().slice(0, 7);
  }

  const ageCohorts = ageBuckets.map((b) => ({
    label: b.label,
    articles: b.articles,
    avgViews: b.articles > 0 ? Math.round((b.views / b.articles) * 10) / 10 : null,
  }));

  return {
    source: "first-party",
    period,
    byMonth,
    ageCohorts,
    notes: [
      "First 28 days counts beacon-measured views from the article's publication date (Kolkata calendar) forward.",
      "Age cohorts mix articles of different ages; cumulative views naturally favor older articles — compare within cohorts, not across them.",
    ],
  };
}

async function first28DayViews(sql: Sql, articleIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < articleIds.length; i += 200) {
    const chunk = articleIds.slice(i, i + 200);
    const placeholders = chunk.map((_, k) => `$${k + 1}`).join(",");
    const rows = await sql.query(
      `select article_id, sum(page_views)::int as views
       from analytics_article_session
       where article_id in (${placeholders})
       group by article_id`,
      chunk,
    );
    for (const row of rows as { article_id: string; views: number }[]) {
      out[row.article_id] = Number(row.views ?? 0);
    }
  }
  return out;
}

/** ------------------------------------------------------------------ */
/** CSV export                                                         */
/** ------------------------------------------------------------------ */

export async function analyticsExportCsv(input: {
  table: "articles" | "categories" | "sources" | "devices";
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
    const lines = ["Article,Slug,Category,Published,Age (days),Page views,Sessions,Avg engagement time (s),Engagement rate (%),Completion rate (%),Growth vs previous period (%)"];
    for (const row of data.rows) {
      lines.push([
        csvEscape(row.title), csvEscape(row.slug), csvEscape(row.categoryLabel),
        row.publishedAt ?? "", row.ageDays ?? "", row.views, row.sessions,
        row.avgEngagementTime ?? "", row.engagementRate ?? "", row.completionRate ?? "", row.growth ?? "",
      ].join(","));
    }
    return { csv: lines.join("\n") + "\n", filename: `dypol-articles-${period.from}-to-${period.to}-${stamp}.csv` };
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
