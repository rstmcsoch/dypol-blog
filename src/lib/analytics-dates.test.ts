import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computePeriod,
  kolkataDate,
  kolkataAddDays,
  bucketIndex,
  formatDuration,
  formatPercent,
  percentChange,
  type DatePreset,
} from "./analytics-dates.ts";

/** Walk a Kolkata date forward by `days` days, counting inclusive steps. */
function kolkataDaysBetween(from: string, to: string): number {
  let count = 0;
  let cursor = from;
  while (cursor <= to) {
    count += 1;
    const [y, m, d] = cursor.split("-").map(Number);
    cursor = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(Date.UTC(y, m - 1, d + 1)));
  }
  return count;
}

test("kolkataDate converts UTC to Asia/Kolkata calendar date", () => {
  // 2026-10-22T18:30:00Z is 2026-10-23 00:00 IST.
  assert.equal(kolkataDate("2026-10-22T18:30:00Z"), "2026-10-23");
  assert.equal(kolkataDate("2026-10-22T18:29:59Z"), "2026-10-22");
  assert.throws(() => kolkataDate("not-a-date"));
});

test("computePeriod: fixed presets are adjacent to previous period", () => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const presets: DatePreset[] = [
    "today", "yesterday", "last-7", "last-28", "last-30", "last-90", "last-12-months",
  ];
  for (const preset of presets) {
    const period = computePeriod(preset, null);
    if (preset !== "yesterday") assert.equal(period.to, today);
    if (preset === "yesterday") assert.equal(period.to, kolkataAddDays(today, -1));
    assert(period.from <= period.to);
    assert(period.previousFrom <= period.previousTo);
    assert(period.previousTo < period.from, "previous period must end before current starts");
    assert.equal(
      kolkataDaysBetween(period.previousFrom, period.previousTo),
      period.days,
      "previous period must span the same number of days"
    );
    assert.equal(kolkataDaysBetween(period.from, period.to), period.days);
    assert(period.days >= 1);
  }
});

test("computePeriod: last-7 spans 7 days inclusive", () => {
  const period = computePeriod("last-7", null);
  assert.equal(period.days, 7);
  assert.equal(period.label, "Last 7 days");
  assert.equal(period.from, "2026-10-16");
  assert.equal(period.to, "2026-10-22");
});

test("computePeriod: custom range", () => {
  const period = computePeriod("custom", { from: "2026-01-02", to: "2026-01-05" });
  assert.equal(period.from, "2026-01-02");
  assert.equal(period.to, "2026-01-05");
  assert.equal(period.days, 4);
  assert.equal(period.previousFrom, "2025-12-29");
  assert.equal(period.previousTo, "2026-01-01");
});

test("computePeriod: clamps custom range to today", () => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const period = computePeriod("custom", { from: "2020-01-01", to: "2099-12-31" });
  assert.equal(period.to, today);
});

test("bucketIndex maps seconds to the documented intervals", () => {
  assert.equal(bucketIndex(5), 0);
  assert.equal(bucketIndex(10), 1);
  assert.equal(bucketIndex(29), 1);
  assert.equal(bucketIndex(30), 2);
  assert.equal(bucketIndex(60), 3);
  assert.equal(bucketIndex(179), 3);
  assert.equal(bucketIndex(180), 4);
  assert.equal(bucketIndex(300), 5);
  assert.equal(bucketIndex(599), 5);
  assert.equal(bucketIndex(600), 6);
  assert.equal(bucketIndex(99999), 6);
});

test("formatDuration", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(45), "45s");
  assert.equal(formatDuration(60), "1m");
  assert.equal(formatDuration(90), "1m 30s");
  assert.equal(formatDuration(3700), "61m 40s");
});

test("formatPercent", () => {
  assert.equal(formatPercent(50), "50.0%");
  assert.equal(formatPercent(null), "—");
});

test("percentChange", () => {
  assert.equal(percentChange(110, 100), 10);
  assert.equal(percentChange(90, 100), -10);
  assert.equal(percentChange(10, 0), null);
  assert.equal(percentChange(null as unknown as number, 100), null);
});
