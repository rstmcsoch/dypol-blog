import { addBuckets, emptyBuckets, histogramMean, histogramPercentile } from "./histogram.ts";
import { bucketStart, daysBetween, eachDay, type Grain } from "./range.ts";
import type { ArticleQuery, ArticleSort, ArticleStat, DimRow } from "./types.ts";

export type Totals = {
  views: number;
  engagedViews: number;
  engagedMs: number;
  scroll25: number;
  scroll50: number;
  scroll75: number;
  scroll90: number;
  scrollEnd: number;
  internalClicks: number;
  recircViews: number;
  inboundInternal: number;
  buckets: number[];
};

export function emptyTotals(): Totals {
  return {
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
    buckets: emptyBuckets(),
  };
}

function ratio(num: number, den: number): number | null {
  if (den <= 0) return null;
  return num / den;
}

export function rate(num: number, den: number): number | null {
  return ratio(num, den);
}

export function totalsFromArticles(articles: ArticleStat[], which: "current" | "previous"): Totals {
  const t = emptyTotals();
  for (const article of articles) {
    if (which === "current") {
      t.views += article.views;
      t.engagedViews += article.engagedViews;
      t.engagedMs += article.engagedMs;
      t.scroll25 += article.scroll25;
      t.scroll50 += article.scroll50;
      t.scroll75 += article.scroll75;
      t.scroll90 += article.scroll90;
      t.scrollEnd += article.scrollEnd;
      t.internalClicks += article.internalClicks;
      t.recircViews += article.recircViews;
      t.inboundInternal += article.inboundInternal;
      addBuckets(t.buckets, article.buckets);
    } else {
      t.views += article.prevViews;
      t.engagedViews += article.prevEngagedViews;
      t.engagedMs += article.prevEngagedMs;
    }
  }
  return t;
}

export function publishedCount(articles: ArticleStat[], from: string, to: string): number {
  let n = 0;
  for (const article of articles) {
    if (article.publishedDay && article.publishedDay >= from && article.publishedDay <= to) n += 1;
  }
  return n;
}

export type ReadingSummary = {
  avgPerViewMs: number | null;
  avgPerRecordedMs: number | null;
  engagementRate: number | null;
  medianMs: number | null;
  p25Ms: number | null;
  p75Ms: number | null;
  p90Ms: number | null;
  meanMs: number | null;
  recorded: number;
};

export function readingSummary(totals: Totals): ReadingSummary {
  return {
    avgPerViewMs: ratio(totals.engagedMs, totals.views),
    avgPerRecordedMs: ratio(totals.engagedMs, totals.engagedViews),
    engagementRate: ratio(totals.engagedViews, totals.views),
    medianMs: histogramPercentile(totals.buckets, 50),
    p25Ms: histogramPercentile(totals.buckets, 25),
    p75Ms: histogramPercentile(totals.buckets, 75),
    p90Ms: histogramPercentile(totals.buckets, 90),
    meanMs: histogramMean(totals.buckets),
    recorded: totals.buckets.reduce((s, n) => s + n, 0),
  };
}

export function articleMatches(article: ArticleStat, query: ArticleQuery): boolean {
  const q = query.q.trim().toLowerCase();
  if (q && !article.title.toLowerCase().includes(q) && !article.slug.toLowerCase().includes(q)) return false;
  if (query.category && !article.topics.some((topic) => topic.slug === query.category) && article.categorySlug !== query.category) {
    return false;
  }
  if (query.tag && !article.tags.some((tag) => tag.slug === query.tag)) return false;
  if (query.age !== "any") {
    if (!article.publishedDay) return false;
    const age = daysBetween(article.publishedDay, query.today);
    if (query.age === "7" && age > 6) return false;
    if (query.age === "28" && age > 27) return false;
    if (query.age === "90" && age > 89) return false;
    if (query.age === "older90" && age < 90) return false;
  }
  return true;
}

export function filterArticles(articles: ArticleStat[], query: ArticleQuery): ArticleStat[] {
  return articles.filter((article) => articleMatches(article, query));
}

function growth(article: ArticleStat): number {
  if (article.prevViews === 0) return article.views > 0 ? Number.POSITIVE_INFINITY : 0;
  return (article.views - article.prevViews) / article.prevViews;
}

function safeRatio(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

export function sortArticles(articles: ArticleStat[], sort: ArticleSort): ArticleStat[] {
  const copy = [...articles];
  const cmp = (a: number, b: number) => (a === b ? 0 : a > b ? -1 : 1);
  copy.sort((a, b) => {
    if (sort === "views") return cmp(a.views, b.views) || a.title.localeCompare(b.title);
    if (sort === "engagement") return cmp(safeRatio(a.engagedViews, a.views), safeRatio(b.engagedViews, b.views)) || cmp(a.views, b.views);
    if (sort === "reading") {
      return cmp(safeRatio(a.engagedMs, a.engagedViews), safeRatio(b.engagedMs, b.engagedViews)) || cmp(a.engagedViews, b.engagedViews);
    }
    if (sort === "completion") return cmp(safeRatio(a.scrollEnd, a.views), safeRatio(b.scrollEnd, b.views)) || cmp(a.views, b.views);
    if (sort === "recirc") return cmp(a.internalClicks, b.internalClicks) || cmp(a.views, b.views);
    if (sort === "newest") return (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") || a.title.localeCompare(b.title);
    const ga = growth(a);
    const gb = growth(b);
    if (sort === "declining") {
      const aNeg = ga < 0 && Number.isFinite(ga);
      const bNeg = gb < 0 && Number.isFinite(gb);
      if (aNeg && bNeg) return ga - gb;
      if (aNeg) return -1;
      if (bNeg) return 1;
      return cmp(a.views, b.views);
    }
    const aScore = Number.isFinite(ga) ? ga : Number.POSITIVE_INFINITY;
    const bScore = Number.isFinite(gb) ? gb : Number.POSITIVE_INFINITY;
    return cmp(aScore, bScore) || cmp(a.views, b.views);
  });
  return copy;
}

export type SeriesPoint = { key: string; label: string; views: number; engagedViews: number; engagedMs: number; otherViews: number };

export function buildSeries(articles: ArticleStat[], otherByDay: Map<string, number>, from: string, to: string, grain: Grain): SeriesPoint[] {
  const map = new Map<string, SeriesPoint>();
  const ensure = (day: string) => {
    const key = bucketStart(day, from, grain);
    let row = map.get(key);
    if (!row) {
      row = {
        key,
        label: grain === "month" ? key.slice(0, 7) : key,
        views: 0,
        engagedViews: 0,
        engagedMs: 0,
        otherViews: 0,
      };
      map.set(key, row);
    }
    return row;
  };
  for (const day of eachDay(from, to)) ensure(day);
  for (const article of articles) {
    for (const point of article.days) {
      if (point.day < from || point.day > to) continue;
      const row = ensure(point.day);
      row.views += point.views;
      row.engagedViews += point.engagedViews;
      row.engagedMs += point.engagedMs;
    }
  }
  for (const [day, views] of otherByDay) {
    if (day < from || day > to) continue;
    ensure(day).otherViews += views;
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export type TopicRow = {
  slug: string;
  label: string;
  views: number;
  prevViews: number;
  engagedViews: number;
  engagedMs: number;
  scrollEnd: number;
  articles: number;
  articlesWithViews: number;
  topArticle: { title: string; slug: string; id: string; views: number } | null;
};

export function topicRows(articles: ArticleStat[]): TopicRow[] {
  const map = new Map<string, TopicRow>();
  for (const article of articles) {
    const topics = article.topics.length ? article.topics : article.categorySlug ? [{ slug: article.categorySlug, label: article.categoryLabel || article.categorySlug }] : [];
    for (const topic of topics) {
      let row = map.get(topic.slug);
      if (!row) {
        row = {
          slug: topic.slug,
          label: topic.label,
          views: 0,
          prevViews: 0,
          engagedViews: 0,
          engagedMs: 0,
          scrollEnd: 0,
          articles: 0,
          articlesWithViews: 0,
          topArticle: null,
        };
        map.set(topic.slug, row);
      }
      row.articles += 1;
      row.views += article.views;
      row.prevViews += article.prevViews;
      row.engagedViews += article.engagedViews;
      row.engagedMs += article.engagedMs;
      row.scrollEnd += article.scrollEnd;
      if (article.views > 0) row.articlesWithViews += 1;
      if (!row.topArticle || article.views > row.topArticle.views) {
        row.topArticle = { title: article.title, slug: article.slug, id: article.id, views: article.views };
      }
    }
  }
  return [...map.values()].sort((a, b) => b.views - a.views || a.label.localeCompare(b.label));
}

export type TopicRank = TopicRow & { score: number; reliable: boolean; viewShare: number };

/**
 * Rank = 50% view share + 30% engagement rate (vs the best topic) + 20% average
 * recorded time (vs the best topic). Topics under 8 views are listed but not ranked.
 */
export function rankTopics(rows: TopicRow[]): TopicRank[] {
  const total = rows.reduce((s, r) => s + r.views, 0);
  const eligible = rows.filter((r) => r.views >= 8);
  const maxRate = Math.max(0, ...eligible.map((r) => (r.views > 0 ? r.engagedViews / r.views : 0)));
  const maxTime = Math.max(0, ...eligible.map((r) => (r.engagedViews > 0 ? r.engagedMs / r.engagedViews : 0)));
  return rows
    .map((row) => {
      const viewShare = total > 0 ? row.views / total : 0;
      const reliable = row.views >= 8;
      const eRate = row.views > 0 ? row.engagedViews / row.views : 0;
      const time = row.engagedViews > 0 ? row.engagedMs / row.engagedViews : 0;
      const score = reliable ? viewShare * 0.5 + (maxRate > 0 ? eRate / maxRate : 0) * 0.3 + (maxTime > 0 ? time / maxTime : 0) * 0.2 : 0;
      return { ...row, score, reliable, viewShare };
    })
    .sort((a, b) => Number(b.reliable) - Number(a.reliable) || b.score - a.score || b.views - a.views);
}

export type TagRow = { slug: string; label: string; views: number; prevViews: number; engagedViews: number; engagedMs: number; articles: number };

export function tagRows(articles: ArticleStat[]): TagRow[] {
  const map = new Map<string, TagRow>();
  for (const article of articles) {
    for (const tag of article.tags) {
      let row = map.get(tag.slug);
      if (!row) {
        row = { slug: tag.slug, label: tag.label, views: 0, prevViews: 0, engagedViews: 0, engagedMs: 0, articles: 0 };
        map.set(tag.slug, row);
      }
      row.articles += 1;
      row.views += article.views;
      row.prevViews += article.prevViews;
      row.engagedViews += article.engagedViews;
      row.engagedMs += article.engagedMs;
    }
  }
  return [...map.values()].sort((a, b) => b.views - a.views || a.label.localeCompare(b.label));
}

export type Insight = { id: string; tone: "up" | "down" | "neutral" | "caution"; title: string; detail: string };

export function buildInsights(input: {
  rangeLabel: string;
  previousLabel: string;
  periodEnd: string;
  articles: ArticleStat[];
  channels: DimRow[];
  publishedNow: number;
  publishedPrev: number;
}): Insight[] {
  const insights: Insight[] = [];
  const current = totalsFromArticles(input.articles, "current");
  const previous = totalsFromArticles(input.articles, "previous");
  const reads = readingSummary(current);
  if (current.views === 0 && previous.views === 0) {
    insights.push({
      id: "no-period-views",
      tone: "neutral",
      title: "No article views were recorded in this period",
      detail: `The dated charts only include views stored after daily statistics began. Lifetime counters, if any, are separate and are not a substitute for ${input.rangeLabel}.`,
    });
  } else if (previous.views === 0 && current.views > 0) {
    insights.push({
      id: "views-new",
      tone: "up",
      title: "Article views showed up with no baseline in the previous period",
      detail: `${current.views.toLocaleString("en-IN")} article views in ${input.rangeLabel}. The previous window (${input.previousLabel}) has 0, so a percentage change is not shown.`,
    });
  } else if (previous.views > 0) {
    const delta = (current.views - previous.views) / previous.views;
    if (delta >= 0.1) {
      insights.push({
        id: "views-up",
        tone: "up",
        title: `Article views are up ${Math.round(delta * 100)}% versus the previous period`,
        detail: `${current.views.toLocaleString("en-IN")} views in ${input.rangeLabel}, compared with ${previous.views.toLocaleString("en-IN")} in ${input.previousLabel}. This is a comparison, not a cause.`,
      });
    } else if (delta <= -0.1) {
      insights.push({
        id: "views-down",
        tone: "down",
        title: `Article views are down ${Math.round(Math.abs(delta) * 100)}% versus the previous period`,
        detail: `${current.views.toLocaleString("en-IN")} views in ${input.rangeLabel}, compared with ${previous.views.toLocaleString("en-IN")} in ${input.previousLabel}.`,
      });
    }
  }

  const topics = topicRows(input.articles);
  const totalViews = topics.reduce((s, t) => s + t.views, 0);
  const prevTopicViews = topics.reduce((s, t) => s + t.prevViews, 0);
  for (const topic of topics) {
    if (topic.views < 8 || totalViews <= 0 || prevTopicViews <= 0) continue;
    const share = topic.views / totalViews;
    const prevShare = topic.prevViews / prevTopicViews;
    if (share - prevShare >= 0.05) {
      insights.push({
        id: `topic-share-${topic.slug}`,
        tone: "up",
        title: `${topic.label} has a larger share of article views`,
        detail: `${Math.round(share * 100)}% of article views in ${input.rangeLabel}, compared with ${Math.round(prevShare * 100)}% in ${input.previousLabel} (${topic.views.toLocaleString("en-IN")} views).`,
      });
      break;
    }
  }
  for (const topic of topics) {
    if (topic.views > 0 && topic.views < 8) {
      insights.push({
        id: `topic-thin-${topic.slug}`,
        tone: "caution",
        title: `${topic.label} does not have enough views for a firm ranking`,
        detail: `Only ${topic.views.toLocaleString("en-IN")} article views in ${input.rangeLabel}. Topics are ranked only from 8 views upward.`,
      });
      break;
    }
  }

  const siteRate = reads.engagementRate;
  if (siteRate != null && current.views >= 20) {
    const standout = input.articles
      .filter((a) => a.views >= 12 && a.views <= Math.max(...input.articles.map((x) => x.views)) * 0.5)
      .map((a) => ({ a, rate: a.engagedViews / a.views }))
      .filter((row) => row.rate >= siteRate * 1.4 && row.a.engagedViews >= 5)
      .sort((x, y) => y.rate - x.rate)[0];
    if (standout) {
      insights.push({
        id: `engaged-${standout.a.id}`,
        tone: "up",
        title: `${standout.a.title} is being read more deeply than its traffic suggests`,
        detail: `Engagement rate ${Math.round(standout.rate * 100)}% on ${standout.a.views.toLocaleString("en-IN")} views, versus ${Math.round(siteRate * 100)}% across the filtered articles in ${input.rangeLabel}. Engagement rate means recorded reading beacons divided by article views.`,
      });
    }
    const weak = input.articles
      .filter((a) => a.views >= 20)
      .map((a) => ({ a, rate: a.engagedViews / a.views }))
      .filter((row) => row.rate <= siteRate * 0.55)
      .sort((x, y) => y.a.views - x.a.views)[0];
    if (weak) {
      insights.push({
        id: `weak-${weak.a.id}`,
        tone: "caution",
        title: `${weak.a.title} has traffic with comparatively weak recorded reading`,
        detail: `${weak.a.views.toLocaleString("en-IN")} views and a ${Math.round(weak.rate * 100)}% engagement rate, against ${Math.round(siteRate * 100)}% for the filtered set in ${input.rangeLabel}. A short article can also produce a low time; this is not a quality verdict.`,
      });
    }
  }

  const evergreen = input.articles
    .filter((a) => a.publishedDay && daysBetween(a.publishedDay, input.periodEnd) >= 90 && a.views >= 8)
    .sort((a, b) => b.views - a.views)[0];
  if (evergreen?.publishedDay) {
    insights.push({
      id: `evergreen-${evergreen.id}`,
      tone: "neutral",
      title: `${evergreen.title} is an older article that is still being opened`,
      detail: `Published ${evergreen.publishedDay} (90 or more days before the end of this period) and recorded ${evergreen.views.toLocaleString("en-IN")} views in ${input.rangeLabel}.`,
    });
  }

  const rankedChannels = [...input.channels].filter((c) => c.views >= 8).sort((a, b) => b.views - a.views);
  if (rankedChannels.length >= 2) {
    const top = rankedChannels[0];
    const deeper = rankedChannels
      .slice(1)
      .map((c) => ({ c, time: c.engagedViews > 0 ? c.engagedMs / c.engagedViews : 0, topTime: top.engagedViews > 0 ? top.engagedMs / top.engagedViews : 0 }))
      .filter((row) => row.c.engagedViews >= 5 && row.time > row.topTime * 1.25 && row.topTime > 0)
      .sort((a, b) => b.time - a.time)[0];
    if (deeper) {
      insights.push({
        id: `channel-${deeper.c.key}`,
        tone: "neutral",
        title: `${deeper.c.label} sent fewer views than ${top.label}, with a longer recorded read`,
        detail: `${deeper.c.views.toLocaleString("en-IN")} views and about ${Math.round(deeper.time / 1000)}s average recorded time, versus ${top.views.toLocaleString("en-IN")} views and ${Math.round(deeper.topTime / 1000)}s for ${top.label} in ${input.rangeLabel}.`,
      });
    }
  }

  if (input.publishedNow !== input.publishedPrev) {
    insights.push({
      id: "publishing-pace",
      tone: input.publishedNow >= input.publishedPrev ? "neutral" : "down",
      title: `${input.publishedNow.toLocaleString("en-IN")} articles were published in this period`,
      detail: `The previous equivalent window had ${input.publishedPrev.toLocaleString("en-IN")}. Publishing counts use the article's publication date in Asia/Kolkata, not its view count.`,
    });
  }

  insights.push({
    id: "search-unavailable",
    tone: "neutral",
    title: "Search impressions and clicks are not in this report",
    detail: "Google Search Console is not connected, so no query, impression, click or average-position figure is shown. Connect it before treating SEO movement as measured.",
  });

  return insights.slice(0, 8);
}

export function lengthBands(articles: ArticleStat[]): { label: string; articles: number; views: number; avgMs: number | null }[] {
  const bands = [
    { label: "Under 3 min (approx.)", min: 0, max: 2, articles: 0, views: 0, engagedMs: 0, engagedViews: 0 },
    { label: "3–7 min (approx.)", min: 3, max: 7, articles: 0, views: 0, engagedMs: 0, engagedViews: 0 },
    { label: "Over 7 min (approx.)", min: 8, max: 10_000, articles: 0, views: 0, engagedMs: 0, engagedViews: 0 },
  ];
  for (const article of articles) {
    const band = bands.find((b) => article.minutes >= b.min && article.minutes <= b.max);
    if (!band) continue;
    band.articles += 1;
    band.views += article.views;
    band.engagedMs += article.engagedMs;
    band.engagedViews += article.engagedViews;
  }
  return bands.map((b) => ({
    label: b.label,
    articles: b.articles,
    views: b.views,
    avgMs: b.engagedViews > 0 ? b.engagedMs / b.engagedViews : null,
  }));
}

export function cohortReadyNote(article: ArticleStat): string {
  if (!article.publishedDay) return "Not published";
  if (!article.first28Complete) return "28-day window still open";
  return "28-day window complete";
}

export function topBy<T>(rows: T[], n: number): T[] {
  return rows.slice(0, n);
}

export function sumDim(rows: DimRow[]): number {
  return rows.reduce((s, r) => s + r.views, 0);
}
