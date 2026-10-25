import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignSeries, articleRecirculation, classifyVisitors, completionQualifies, deltaPercent, growth,
  insightsAllowed, niceMax, scrollFunnel, sessionsFromReads, shortDate, summarize, type ReadRow,
} from "./analytics-metrics.ts";

const r = (session_id: string, date: string, article_id: string, page_views: number, engaged_seconds: number, extra: Partial<ReadRow> = {}): ReadRow =>
  ({ session_id, date, article_id, page_views, engaged_seconds, completed: 0, ...extra });

test("sessions are visitor × IST day; GA4 engaged rule (10s OR 2+ views OR key event)", () => {
  const rows = [
    r("a", "2026-10-22", "x", 1, 4),          // a/22: 1 view, 4s, no key event → not engaged
    r("b", "2026-10-22", "x", 1, 12),         // engaged by time
    r("c", "2026-10-22", "x", 1, 2), r("c", "2026-10-22", "y", 1, 2), // engaged by 2 views
    r("d", "2026-10-23", "x", 1, 1, { key_events: 1 }), // engaged by key event
    r("a", "2026-10-23", "y", 1, 3),          // a again next day → separate session
  ];
  const s = sessionsFromReads(rows);
  assert.equal(s.length, 5);
  const sum = summarize(s);
  assert.equal(sum.sessions, 5);
  assert.equal(sum.engagedSessions, 3);
  assert.equal(sum.engagementRate, 60);
  assert.equal(sum.bounceRate, 40);
  assert.equal(sum.pageViews, 6);
  // avg engaged time = total engaged ÷ page views = 24 / 6
  assert.equal(sum.avgEngagedTime, 4);
});

test("empty period gives nulls, not zeros", () => {
  const sum = summarize([]);
  assert.equal(sum.engagementRate, null);
  assert.equal(sum.bounceRate, null);
  assert.equal(sum.avgEngagedTime, null);
});

test("growth: 0→0 is —, x→0 is −100%, 0→x is New", () => {
  assert.equal(growth(0, 0).label, "—");
  assert.equal(growth(0, 5).value, -100);
  assert.equal(growth(0, 5).label, "−100%");
  assert.equal(growth(3, 0).label, "New");
  assert.equal(growth(3, 0).value, null);
  assert.equal(growth(15, 10).label, "+50%");
  assert.ok(growth(3, 0).rank > growth(15, 10).rank);
});

test("deltas need prior data", () => {
  assert.equal(deltaPercent(10, 0, false), null);
  assert.equal(deltaPercent(10, 5, true), 100);
});

test("completion needs ≥15s engaged", () => {
  assert.equal(completionQualifies({ completed: 1, engaged_seconds: 0 }), false);
  assert.equal(completionQualifies({ completed: 1, engaged_seconds: 4 }), false);
  assert.equal(completionQualifies({ completed: 1, engaged_seconds: 15 }), true);
  assert.equal(completionQualifies({ completed: 0, engaged_seconds: 60 }), false);
});

test("returning = more than one visit day in 30 days", () => {
  const dates = new Map([["a", new Set(["2026-10-01", "2026-10-20"])], ["b", new Set(["2026-10-20"])]]);
  assert.deepEqual(classifyVisitors(["a", "b"], dates), { users: 2, newUsers: 1, returningUsers: 1 });
});

test("series align by day index on the current axis with short labels", () => {
  const a = alignSeries(
    [{ date: "2026-10-20", value: 3 }, { date: "2026-10-21", value: 4 }],
    [{ date: "2026-10-18", value: 1 }, { date: "2026-10-19", value: 2 }],
  );
  assert.equal(a[0].label, "20 Oct");
  assert.equal(a[1].previous, 2);
  assert.equal(a[1].date, "2026-10-21");
  assert.equal(alignSeries([{ date: "2026-10-20", value: 1 }], null)[0].previous, null);
  assert.equal(shortDate("2026-09-02"), "2 Sep");
});

test("y-domain always contains the data", () => {
  for (const v of [[0], [1], [4], [6], [33], [99], [101], [2950]]) assert.ok(niceMax(v) >= Math.max(...v));
  assert.ok(niceMax([33]) > 33);
});

test("per-article recirculation and insight sample gate", () => {
  assert.equal(articleRecirculation(0, 3), null);
  assert.equal(articleRecirculation(4, 1), 25);
  assert.equal(articleRecirculation(2, 5), 100);
  assert.equal(insightsAllowed(19), false);
  assert.equal(insightsAllowed(20), true);
});

test("scroll funnel 25/50/75/100", () => {
  const f = scrollFunnel([10, 30, 60, 80, 100]);
  assert.deepEqual(f.map((x) => x.reads), [4, 3, 2, 1]);
  assert.equal(f[0].share, 80);
});
