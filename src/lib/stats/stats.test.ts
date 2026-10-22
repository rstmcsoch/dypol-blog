import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInsights, filterArticles, rankTopics, readingSummary, sortArticles, totalsFromArticles, topicRows } from "./aggregate.ts";
import { classifyAcquisition, classifyUserAgent, hasDeskSessionCookie, shouldMeterPath } from "./classify.ts";
import { csvCell, formatDelta, toCsv } from "./format.ts";
import { bucketIndex, histogramMean, histogramPercentile, READ_BUCKETS } from "./histogram.ts";
import { parseEngageBody } from "./payload.ts";
import { addDays, daysInclusive, grainFor, kolkataDay, previousRange, resolveRange } from "./range.ts";
import type { ArticleStat } from "./types.ts";

test("Kolkata civil day does not follow UTC when it is still the previous evening there", () => {
  // 2026-10-21 20:30 UTC is 2026-10-22 02:00 in Asia/Kolkata.
  assert.equal(kolkataDay(new Date("2026-10-21T20:30:00.000Z")), "2026-10-22");
  assert.equal(kolkataDay(new Date("2026-10-21T18:00:00.000Z")), "2026-10-21");
});

test("presets are inclusive Asia/Kolkata windows and the previous window has the same length", () => {
  const now = new Date("2026-10-21T20:30:00.000Z");
  const week = resolveRange({ preset: "7d" }, now);
  assert.equal(week.from, "2026-10-16");
  assert.equal(week.to, "2026-10-22");
  assert.equal(daysInclusive(week.from, week.to), 7);
  const prev = previousRange(week);
  assert.equal(prev.to, "2026-10-15");
  assert.equal(prev.from, "2026-10-09");
  assert.equal(daysInclusive(prev.from, prev.to), 7);
  const year = resolveRange({ preset: "12m" }, now);
  assert.equal(daysInclusive(year.from, year.to), 365);
  assert.equal(grainFor(week.from, week.to), "day");
  assert.equal(grainFor(year.from, year.to), "month");
});

test("custom ranges reject inverted dates, the future, and spans over 366 days", () => {
  const now = new Date("2026-10-22T04:00:00.000Z");
  assert.throws(() => resolveRange({ preset: "custom", from: "2026-10-10", to: "2026-10-01" }, now));
  assert.throws(() => resolveRange({ preset: "custom", from: "2026-10-01", to: "2026-10-23" }, now));
  assert.throws(() => resolveRange({ preset: "custom", from: "2024-01-01", to: "2025-06-01" }, now));
  const ok = resolveRange({ preset: "custom", from: "2026-10-01", to: "2026-10-22" }, now);
  assert.equal(ok.from, "2026-10-01");
});

test("histogram median is not the mean of a skewed distribution", () => {
  const counts = [100, 0, 0, 0, 0, 0, 10];
  const median = histogramPercentile(counts, 50);
  const mean = histogramMean(counts);
  assert.ok(median != null && median < 10_000, "median stays inside Under 10 seconds");
  assert.ok(mean != null && mean > 10_000, "midpoint mean is pulled up by the long bucket");
  assert.equal(histogramPercentile([0, 0, 0, 0, 0, 0, 0], 50), null);
});

test("bucket edges match the documented intervals", () => {
  assert.equal(READ_BUCKETS.length, 7);
  assert.equal(bucketIndex(0), 0);
  assert.equal(bucketIndex(9_999), 0);
  assert.equal(bucketIndex(10_000), 1);
  assert.equal(bucketIndex(59_999), 2);
  assert.equal(bucketIndex(60_000), 3);
  assert.equal(bucketIndex(600_000), 6);
  assert.equal(bucketIndex(9_999_999), 6);
});

test("acquisition prefers campaign parameters and does not call a missing referrer typed-in traffic", () => {
  assert.equal(classifyAcquisition({ refHost: "", selfHost: "dypolblog.rstmcsoch.workers.dev", utmSource: "", utmMedium: "", utmCampaign: "" }).channel, "direct");
  assert.equal(classifyAcquisition({ refHost: "https://www.google.co.in/search?q=x", selfHost: "dypolblog.rstmcsoch.workers.dev", utmSource: "", utmMedium: "", utmCampaign: "" }).channel, "organic");
  assert.equal(classifyAcquisition({ refHost: "news.ycombinator.com", selfHost: "dypolblog.rstmcsoch.workers.dev", utmSource: "", utmMedium: "", utmCampaign: "" }).channel, "social");
  assert.equal(classifyAcquisition({ refHost: "example.com/path?a=1", selfHost: "dypolblog.rstmcsoch.workers.dev", utmSource: "", utmMedium: "", utmCampaign: "" }).channel, "referral");
  const campaign = classifyAcquisition({ refHost: "www.google.com", selfHost: "dypolblog.rstmcsoch.workers.dev", utmSource: "Newsletter!", utmMedium: "email", utmCampaign: "" });
  assert.equal(campaign.channel, "campaign");
  assert.equal(campaign.campaign?.source, "newsletter");
  assert.equal(classifyAcquisition({ refHost: "127.0.0.1", selfHost: "dypolblog.rstmcsoch.workers.dev", utmSource: "", utmMedium: "", utmCampaign: "" }).channel, "direct");
  assert.equal(classifyAcquisition({ refHost: "dypolblog.rstmcsoch.workers.dev", selfHost: "dypolblog.rstmcsoch.workers.dev", utmSource: "", utmMedium: "", utmCampaign: "" }).channel, "internal");
});

test("user agent classification is coarse and does not keep the raw string", () => {
  const phone = classifyUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1");
  assert.deepEqual(phone, { device: "mobile", browser: "safari", os: "ios" });
  const edge = classifyUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0");
  assert.equal(edge.browser, "edge");
  assert.equal(edge.os, "windows");
  assert.equal(edge.device, "desktop");
  assert.equal(classifyUserAgent("").device, "unknown");
});

test("public meter skips articles, admin and files", () => {
  assert.equal(shouldMeterPath("/"), true);
  assert.equal(shouldMeterPath("/topics/tech-news"), true);
  assert.equal(shouldMeterPath("/articles"), true);
  assert.equal(shouldMeterPath("/articles/hello-world"), false);
  assert.equal(shouldMeterPath("/admin/stats"), false);
  assert.equal(shouldMeterPath("/favicon.ico"), false);
  assert.equal(hasDeskSessionCookie("dypol_desk=abc"), true);
  assert.equal(hasDeskSessionCookie("dypol_desk="), false);
  assert.equal(hasDeskSessionCookie(null), false);
});

test("engage payload rejects out-of-range numbers and keeps a bounded duration", () => {
  assert.equal(parseEngageBody({ engagedMs: 5000, scrollPct: 40, internalClicks: 1 })?.engagedMs, 5000);
  assert.equal(parseEngageBody({ engagedMs: 9_000_000, scrollPct: 10, internalClicks: 0 })?.engagedMs, 1_200_000);
  assert.equal(parseEngageBody({ engagedMs: -5, scrollPct: 10, internalClicks: 0 })?.engagedMs, 0);
  assert.equal(parseEngageBody({ engagedMs: "5", scrollPct: 10, internalClicks: 0 }), null);
  assert.equal(parseEngageBody(null), null);
});

function article(partial: Partial<ArticleStat> & Pick<ArticleStat, "id" | "title">): ArticleStat {
  return {
    slug: partial.id,
    status: "published",
    publishedAt: "2026-09-01T00:00:00.000Z",
    publishedDay: "2026-09-01",
    categorySlug: "tech-news",
    categoryLabel: "Tech News",
    topics: [{ slug: "tech-news", label: "Tech News" }],
    tags: [],
    words: 800,
    minutes: 4,
    lengthApproximate: true,
    lifetimeViews: 0,
    views: 0,
    prevViews: 0,
    engagedViews: 0,
    prevEngagedViews: 0,
    engagedMs: 0,
    prevEngagedMs: 0,
    scroll25: 0,
    scroll50: 0,
    scroll75: 0,
    scroll90: 0,
    scrollEnd: 0,
    internalClicks: 0,
    recircViews: 0,
    inboundInternal: 0,
    buckets: [0, 0, 0, 0, 0, 0, 0],
    days: [],
    viewsFirstDay: 0,
    viewsFirst7: 0,
    viewsFirst28: 0,
    first7Complete: true,
    first28Complete: true,
    ...partial,
  };
}

test("leaderboard sort, filter and topic rank use views and engagement separately", () => {
  const rows = [
    article({ id: "a", title: "Alpha chip note", views: 10, prevViews: 40, engagedViews: 8, engagedMs: 80_000, topics: [{ slug: "chips-gaming", label: "Chips & Gaming" }], categorySlug: "chips-gaming", categoryLabel: "Chips & Gaming" }),
    article({ id: "b", title: "Beta phones", slug: "beta-phones", views: 50, prevViews: 20, engagedViews: 5, engagedMs: 10_000 }),
    article({ id: "c", title: "Quiet draft", views: 0, tags: [{ slug: "leak", label: "Leak" }] }),
  ];
  assert.equal(sortArticles(rows, "views")[0].id, "b");
  assert.equal(sortArticles(rows, "declining")[0].id, "a");
  assert.equal(sortArticles(rows, "engagement")[0].id, "a");
  const found = filterArticles(rows, { q: "beta", category: "", tag: "", age: "any", sort: "views", today: "2026-10-22" });
  assert.deepEqual(found.map((row) => row.id), ["b"]);
  const ranked = rankTopics(topicRows(rows));
  const chips = ranked.find((row) => row.slug === "chips-gaming");
  assert.equal(chips?.reliable, true);
  assert.ok((chips?.score ?? 0) > 0);
});

test("a views increase becomes an insight and an empty period does not invent a median", () => {
  const up = article({ id: "a", title: "Alpha", views: 30, prevViews: 10, engagedViews: 10, engagedMs: 60_000, buckets: [0, 10, 0, 0, 0, 0, 0] });
  const notes = buildInsights({
    rangeLabel: "16 Oct 2026 – 22 Oct 2026",
    previousLabel: "9 Oct 2026 – 15 Oct 2026",
    periodEnd: "2026-10-22",
    articles: [up],
    channels: [],
    publishedNow: 1,
    publishedPrev: 1,
  });
  assert.ok(notes.some((note) => note.id === "views-up"));
  const empty = readingSummary(totalsFromArticles([article({ id: "z", title: "Zero" })], "current"));
  assert.equal(empty.medianMs, null);
  assert.equal(empty.engagementRate, null);
});

test("csv escapes quotes and commas", () => {
  assert.equal(csvCell('say "hi", friend'), '"say ""hi"", friend"');
  assert.equal(toCsv(["A"], [["ok"]]).startsWith("\uFEFFA\nok"), true);
});

test("percent deltas do not divide by zero", () => {
  assert.equal(formatDelta(0, 0).tone, "flat");
  assert.equal(formatDelta(4, 0).tone, "new");
  assert.equal(formatDelta(15, 10).text, "+50%");
  assert.equal(addDays("2026-10-22", -1), "2026-10-21");
});
