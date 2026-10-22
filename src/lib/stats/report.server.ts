import { DatabaseUnavailableError, getSql, type Sql } from "@/lib/db";
import { GA_MEASUREMENT_ID } from "@/lib/analytics";
import {
  BROWSER_LABEL,
  CHANNEL_LABEL,
  countryLabel,
  DEVICE_LABEL,
  OS_LABEL,
  type BrowserName,
  type Channel,
  type Device,
  type OsName,
} from "./classify";
import { ensureStatsSchema } from "./ingest.server";
import { daysBetween, daysInclusive, grainFor, kolkataDay, previousRange, resolveRange, type StatsRequest } from "./range";
import type { ArticleDay, ArticleStat, DimRow, StatsPayload } from "./types";

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; payload: StatsPayload }>();
const hits: number[] = [];

function allowReport(): boolean {
  const now = Date.now();
  while (hits.length && now - hits[0] > 60_000) hits.shift();
  if (hits.length >= 40) return false;
  hits.push(now);
  return true;
}

function n(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function wordsFromChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.max(0, Math.round(chars / 6));
}

function minutesFromWords(words: number): number {
  if (words <= 0) return 0;
  return Math.max(1, Math.round(words / 220));
}

type ArticleRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  published_at: string | null;
  category_slug: string | null;
  category_label: string | null;
  block_chars: number | null;
};

type DailyRow = {
  article_id: string;
  day: string;
  views: number;
  engaged_views: number;
  engaged_ms: number;
  scroll_25: number;
  scroll_50: number;
  scroll_75: number;
  scroll_90: number;
  scroll_end: number;
  internal_clicks: number;
  recirc_views: number;
  inbound_internal: number;
  b0: number;
  b1: number;
  b2: number;
  b3: number;
  b4: number;
  b5: number;
  b6: number;
};

function inRange(day: string, from: string, to: string): boolean {
  return day >= from && day <= to;
}

export async function loadEditorialStats(input: StatsRequest): Promise<StatsPayload> {
  if (!allowReport()) throw new Error("Too many statistics refreshes. Wait a minute and try again.");
  const range = resolveRange(input);
  const previous = previousRange(range);
  const key = `${range.from}|${range.to}`;
  if (!input.fresh) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return { ...hit.payload, fromCache: true };
  }
  try {
    const sql = await getSql();
    await ensureStatsSchema(sql);
    const payload = await build(sql, range, previous);
    cache.set(key, { at: Date.now(), payload });
    if (cache.size > 8) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    return payload;
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) {
      throw new Error("Statistics need the site database, and it is not reachable right now.");
    }
    throw error;
  }
}

async function build(
  sql: Sql,
  range: ReturnType<typeof resolveRange>,
  previous: { from: string; to: string; label: string },
): Promise<StatsPayload> {
  const today = kolkataDay();
  const windowStart = previous.from;

  const articles = await sql.query<ArticleRow>(
    `select a.id as id, a.slug as slug, a.title as title, a.status as status, a.published_at as published_at,
            c.slug as category_slug, c.label as category_label, length(a.blocks) as block_chars
     from articles a
     left join categories c on c.id = a.category_id
     where a.status = 'published'
        or a.id in (select article_id from article_daily_stats where day >= $1)`,
    [windowStart],
  );

  const daily = await sql.query<DailyRow>(
    `select article_id, day, views, engaged_views, engaged_ms, scroll_25, scroll_50, scroll_75, scroll_90, scroll_end,
            internal_clicks, recirc_views, inbound_internal, b0, b1, b2, b3, b4, b5, b6
     from article_daily_stats
     where day >= $1 and day <= $2`,
    [windowStart, today],
  );

  let topicLinks: { article_id: string; slug: string; label: string }[] = [];
  try {
    topicLinks = await sql.query(
      `select at.article_id as article_id, c.slug as slug, c.label as label
       from article_topics at join categories c on c.id = at.category_id`,
    );
  } catch {
    topicLinks = [];
  }
  let tagLinks: { article_id: string; slug: string; label: string }[] = [];
  try {
    tagLinks = await sql.query(
      `select at.article_id as article_id, t.slug as slug, t.label as label
       from article_tags at join tags t on t.id = at.tag_id`,
    );
  } catch {
    tagLinks = [];
  }
  const lifetimes = await sql.query<{ article_id: string; views: number }>(`select article_id, views from article_views`).catch(() => []);

  const topicsByArticle = groupLinks(topicLinks);
  const tagsByArticle = groupLinks(tagLinks);
  const life = new Map(lifetimes.map((row) => [row.article_id, n(row.views)]));
  const dailyByArticle = new Map<string, DailyRow[]>();
  for (const row of daily) {
    const list = dailyByArticle.get(row.article_id) ?? [];
    list.push(row);
    dailyByArticle.set(row.article_id, list);
  }

  const articleStats: ArticleStat[] = articles.map((article) => {
    const rows = dailyByArticle.get(article.id) ?? [];
    const publishedDay = dayInKolkata(article.published_at);
    const words = wordsFromChars(n(article.block_chars));
    const current = fold(rows, range.from, range.to);
    const prev = fold(rows, previous.from, previous.to);
    let viewsFirstDay = 0;
    let viewsFirst7 = 0;
    let viewsFirst28 = 0;
    const days: ArticleDay[] = [];
    for (const row of rows) {
      const views = n(row.views);
      if (publishedDay) {
        const age = daysBetween(publishedDay, row.day);
        if (age === 0) viewsFirstDay += views;
        if (age >= 0 && age < 7) viewsFirst7 += views;
        if (age >= 0 && age < 28) viewsFirst28 += views;
      }
      if (inRange(row.day, previous.from, range.to)) {
        days.push({ day: row.day, views, engagedViews: n(row.engaged_views), engagedMs: n(row.engaged_ms) });
      }
    }
    const ageNow = publishedDay && isDaySafe(publishedDay) ? daysBetween(publishedDay, today) : -1;
    const topics = topicsByArticle.get(article.id) ?? (article.category_slug ? [{ slug: article.category_slug, label: article.category_label || article.category_slug }] : []);
    return {
      id: article.id,
      slug: article.slug,
      title: article.title,
      status: article.status,
      publishedAt: article.published_at,
      publishedDay: publishedDay && isDaySafe(publishedDay) ? publishedDay : null,
      categorySlug: article.category_slug ?? "",
      categoryLabel: article.category_label ?? "",
      topics,
      tags: tagsByArticle.get(article.id) ?? [],
      words,
      minutes: minutesFromWords(words),
      lengthApproximate: true,
      lifetimeViews: life.get(article.id) ?? 0,
      views: current.views,
      prevViews: prev.views,
      engagedViews: current.engagedViews,
      prevEngagedViews: prev.engagedViews,
      engagedMs: current.engagedMs,
      prevEngagedMs: prev.engagedMs,
      scroll25: current.scroll25,
      scroll50: current.scroll50,
      scroll75: current.scroll75,
      scroll90: current.scroll90,
      scrollEnd: current.scrollEnd,
      internalClicks: current.internalClicks,
      recircViews: current.recircViews,
      inboundInternal: current.inboundInternal,
      buckets: current.buckets,
      days,
      viewsFirstDay: publishedDay ? viewsFirstDay : null,
      viewsFirst7: publishedDay ? viewsFirst7 : null,
      viewsFirst28: publishedDay ? viewsFirst28 : null,
      first7Complete: ageNow >= 7,
      first28Complete: ageNow >= 28,
    };
  });

  const siteRows = await sql.query<{ day: string; article_views: number; other_views: number }>(
    `select day, article_views, other_views from site_daily_stats where day >= $1 and day <= $2`,
    [windowStart, today],
  );
  const otherViews = siteRows.filter((row) => inRange(row.day, range.from, range.to)).reduce((s, row) => s + n(row.other_views), 0);
  const prevOtherViews = siteRows.filter((row) => inRange(row.day, previous.from, previous.to)).reduce((s, row) => s + n(row.other_views), 0);

  const channelRows = await sql.query<{ day: string; channel: string; views: number; engaged_views: number; engaged_ms: number }>(
    `select day, channel, views, engaged_views, engaged_ms from traffic_daily_stats where day >= $1 and day <= $2`,
    [windowStart, today],
  );
  const channels = foldDim(
    channelRows.filter((row) => inRange(row.day, range.from, range.to)),
    (row) => row.channel,
    (key) => CHANNEL_LABEL[key as Channel] ?? key,
  );
  const prevChannels = foldDim(
    channelRows.filter((row) => inRange(row.day, previous.from, previous.to)),
    (row) => row.channel,
    (key) => CHANNEL_LABEL[key as Channel] ?? key,
  );

  const deviceRows = await sql.query<{ device: string; views: number; engaged_views: number; engaged_ms: number }>(
    `select device, sum(views) as views, sum(engaged_views) as engaged_views, sum(engaged_ms) as engaged_ms
     from device_daily_stats where day >= $1 and day <= $2 group by device`,
    [range.from, range.to],
  );
  const devices: DimRow[] = deviceRows.map((row) => ({
    key: row.device,
    label: DEVICE_LABEL[row.device as Device] ?? row.device,
    views: n(row.views),
    engagedViews: n(row.engaged_views),
    engagedMs: n(row.engaged_ms),
  }));

  const browsers = await namedCounts(sql, "browser_daily_stats", "browser", range.from, range.to, (key) => BROWSER_LABEL[key as BrowserName] ?? key);
  const operatingSystems = await namedCounts(sql, "os_daily_stats", "os", range.from, range.to, (key) => OS_LABEL[key as OsName] ?? key);

  const countryRows = await sql.query<{ country: string; views: number; engaged_views: number; engaged_ms: number }>(
    `select country, sum(views) as views, sum(engaged_views) as engaged_views, sum(engaged_ms) as engaged_ms
     from geo_daily_stats where day >= $1 and day <= $2 group by country order by views desc limit 40`,
    [range.from, range.to],
  );
  const countries: DimRow[] = countryRows.map((row) => ({
    key: row.country,
    label: countryLabel(row.country),
    views: n(row.views),
    engagedViews: n(row.engaged_views),
    engagedMs: n(row.engaged_ms),
  }));

  const regionRows = await sql.query<{ country: string; region: string; views: number }>(
    `select country, region, sum(views) as views from region_daily_stats
     where day >= $1 and day <= $2 group by country, region order by views desc limit 20`,
    [range.from, range.to],
  );

  const referrers = await sql.query<{ host: string; views: number }>(
    `select host, sum(views) as views from referrer_daily_stats
     where day >= $1 and day <= $2 group by host order by views desc limit 20`,
    [range.from, range.to],
  );

  const campaigns = await sql.query<{ source: string; medium: string; campaign: string; views: number }>(
    `select source, medium, campaign, sum(views) as views from campaign_daily_stats
     where day >= $1 and day <= $2 group by source, medium, campaign order by views desc limit 20`,
    [range.from, range.to],
  );

  const meta = await sql.query<{ value: string }>(`select value from stats_meta where key = 'last_event_at' limit 1`).catch(() => []);
  const publishedTotal = articles.filter((article) => article.status === "published").length;
  const lifetimeViews = [...life.values()].reduce((s, v) => s + v, 0);

  const categoryMap = new Map<string, string>();
  const tagMap = new Map<string, string>();
  for (const article of articleStats) {
    for (const topic of article.topics) categoryMap.set(topic.slug, topic.label);
    for (const tag of article.tags) tagMap.set(tag.slug, tag.label);
  }

  return {
    generatedAt: new Date().toISOString(),
    fromCache: false,
    lastEventAt: meta[0]?.value ?? null,
    timezone: "Asia/Kolkata",
    range: {
      preset: range.preset,
      from: range.from,
      to: range.to,
      label: range.label,
      days: daysInclusive(range.from, range.to),
      grain: grainFor(range.from, range.to),
    },
    previous: { from: previous.from, to: previous.to, label: previous.label },
    lifetimeViews,
    publishedTotal,
    otherViews,
    prevOtherViews,
    otherDays: siteRows.map((row) => ({ day: row.day, views: n(row.other_views) })),
    channels,
    prevChannels,
    channelDays: channelRows
      .filter((row) => inRange(row.day, range.from, range.to))
      .map((row) => ({
        day: row.day,
        channel: row.channel,
        views: n(row.views),
        engagedViews: n(row.engaged_views),
        engagedMs: n(row.engaged_ms),
      })),
    devices,
    browsers,
    operatingSystems,
    countries,
    regions: regionRows.map((row) => ({
      country: row.country,
      countryLabel: countryLabel(row.country),
      region: row.region,
      views: n(row.views),
    })),
    referrers: referrers.map((row) => ({ host: row.host, views: n(row.views) })),
    campaigns: campaigns.map((row) => ({ ...row, views: n(row.views) })),
    articles: articleStats,
    categories: [...categoryMap.entries()].map(([slug, label]) => ({ slug, label })).sort((a, b) => a.label.localeCompare(b.label)),
    tags: [...tagMap.entries()].map(([slug, label]) => ({ slug, label })).sort((a, b) => a.label.localeCompare(b.label)),
    sources: {
      ga4MeasurementId: GA_MEASUREMENT_ID,
      ga4Reporting: "not_connected",
      searchConsole: "not_connected",
      webVitals: "not_available",
      sessions: "not_measured",
      uniqueUsers: "not_measured",
    },
  };
}

function dayInKolkata(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return kolkataDay(date);
}

function isDaySafe(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function groupLinks(rows: { article_id: string; slug: string; label: string }[]): Map<string, { slug: string; label: string }[]> {
  const map = new Map<string, { slug: string; label: string }[]>();
  for (const row of rows) {
    if (!row.slug) continue;
    const list = map.get(row.article_id) ?? [];
    if (!list.some((item) => item.slug === row.slug)) list.push({ slug: row.slug, label: row.label || row.slug });
    map.set(row.article_id, list);
  }
  return map;
}

function fold(rows: DailyRow[], from: string, to: string) {
  const out = {
    views: 0,
    engagedViews: 0,
    engagedMs: 0,
    scroll25: 0,
    scroll50: 0,
    scroll75: 0,
    scroll90: 0,
    scrollEnd: 0,
    internalClicks: 0,
    recircViews: 0,
    inboundInternal: 0,
    buckets: [0, 0, 0, 0, 0, 0, 0],
  };
  for (const row of rows) {
    if (!inRange(row.day, from, to)) continue;
    out.views += n(row.views);
    out.engagedViews += n(row.engaged_views);
    out.engagedMs += n(row.engaged_ms);
    out.scroll25 += n(row.scroll_25);
    out.scroll50 += n(row.scroll_50);
    out.scroll75 += n(row.scroll_75);
    out.scroll90 += n(row.scroll_90);
    out.scrollEnd += n(row.scroll_end);
    out.internalClicks += n(row.internal_clicks);
    out.recircViews += n(row.recirc_views);
    out.inboundInternal += n(row.inbound_internal);
    out.buckets[0] += n(row.b0);
    out.buckets[1] += n(row.b1);
    out.buckets[2] += n(row.b2);
    out.buckets[3] += n(row.b3);
    out.buckets[4] += n(row.b4);
    out.buckets[5] += n(row.b5);
    out.buckets[6] += n(row.b6);
  }
  return out;
}

function foldDim(
  rows: { channel: string; views: number; engaged_views: number; engaged_ms: number }[],
  keyOf: (row: { channel: string }) => string,
  labelOf: (key: string) => string,
): DimRow[] {
  const map = new Map<string, DimRow>();
  for (const row of rows) {
    const key = keyOf(row);
    const current = map.get(key) ?? { key, label: labelOf(key), views: 0, engagedViews: 0, engagedMs: 0 };
    current.views += n(row.views);
    current.engagedViews += n(row.engaged_views);
    current.engagedMs += n(row.engaged_ms);
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.views - a.views);
}

async function namedCounts(sql: Sql, table: string, column: string, from: string, to: string, labelOf: (key: string) => string) {
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column)) return [];
  const rows = await sql.query<Record<string, unknown>>(
    `select ${column} as key, sum(views) as views from ${table} where day >= $1 and day <= $2 group by ${column} order by views desc`,
    [from, to],
  );
  return rows.map((row) => ({
    key: String(row.key ?? ""),
    label: labelOf(String(row.key ?? "")),
    views: n(row.views),
  }));
}
