import assert from "node:assert/strict";
import test from "node:test";
import { nextExpectedRun } from "./schedule.ts";

test("nextExpectedRun: null without times or bad timezone", () => {
  const now = new Date("2026-10-18T00:00:00Z");
  assert.equal(nextExpectedRun({ timezone: "Asia/Kolkata", times: [], days: [] }, now), null);
  assert.equal(nextExpectedRun({ timezone: "Not/AZone", times: ["09:00"], days: [] }, now), null);
});

test("nextExpectedRun: same day later, next day, weekday filter, timezone", () => {
  // 2026-10-18 is a Sunday. 00:00Z = 05:30 in Asia/Kolkata.
  const now = new Date("2026-10-18T00:00:00Z");
  assert.equal(nextExpectedRun({ timezone: "Asia/Kolkata", times: ["06:00"], days: [] }, now)?.toISOString(), "2026-10-18T00:30:00.000Z");
  assert.equal(nextExpectedRun({ timezone: "Asia/Kolkata", times: ["05:00"], days: [] }, now)?.toISOString(), "2026-10-18T23:30:00.000Z");
  // Mondays only: next is Mon 2026-10-19 06:00 IST = 00:30Z
  assert.equal(nextExpectedRun({ timezone: "Asia/Kolkata", times: ["06:00"], days: ["mon"] }, now)?.toISOString(), "2026-10-19T00:30:00.000Z");
  assert.equal(nextExpectedRun({ timezone: "UTC", times: ["00:00"], days: [] }, now)?.toISOString(), "2026-10-19T00:00:00.000Z");
});
