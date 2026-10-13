import assert from "node:assert/strict";
import test from "node:test";
import { describeSchedule, isDue, nextRunAfter, parseCron, zonedTimeToUtc } from "./schedule.ts";

test("cron parsing accepts the shapes the desk allows and refuses nonsense", () => {
  assert.deepEqual(parseCron("0 8 * * *")?.minutes, [0]);
  assert.deepEqual(parseCron("0 8 * * *")?.hours, [8]);
  assert.deepEqual(parseCron("*/15 * * * *")?.minutes, [0, 15, 30, 45]);
  assert.deepEqual(parseCron("0 9-17 * * 1-5")?.hours, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual(parseCron("0 8 * * 7")?.daysOfWeek, [0], "Sunday is normalised");
  assert.equal(parseCron("0 8 * * *")?.dayOfMonthRestricted, false);
  assert.equal(parseCron("0 8 * *"), null);
  assert.equal(parseCron("61 8 * * *"), null);
  assert.equal(parseCron(""), null);
});

test("nextRunAfter is strict, timezone-aware, and survives a DST change", () => {
  const winter = new Date("2026-01-10T00:00:00.000Z");
  const next = nextRunAfter("0 8 * * *", "Asia/Kolkata", winter);
  assert.equal(next?.toISOString(), "2026-01-10T02:30:00.000Z", "08:00 IST is 02:30 UTC");

  const same = nextRunAfter("0 8 * * *", "Asia/Kolkata", new Date("2026-01-10T02:30:00.000Z"));
  assert.equal(same?.toISOString(), "2026-01-11T02:30:00.000Z", "a run already due is not returned again");

  // New York springs forward on 2026-03-08; 09:00 local becomes 13:00 UTC.
  const beforeDst = nextRunAfter("0 9 * * *", "America/New_York", new Date("2026-03-08T00:00:00.000Z"));
  assert.equal(beforeDst?.toISOString(), "2026-03-08T13:00:00.000Z");
  const afterDst = nextRunAfter("0 9 * * *", "America/New_York", new Date("2026-03-09T00:00:00.000Z"));
  assert.equal(afterDst?.toISOString(), "2026-03-09T13:00:00.000Z");

  assert.equal(nextRunAfter("", "UTC", winter), null);
});

test("zonedTimeToUtc maps a wall clock in a named zone", () => {
  const utc = zonedTimeToUtc({ year: 2026, month: 10, day: 13, hour: 9, minute: 30 }, "Europe/Berlin");
  assert.equal(utc.toISOString(), "2026-10-13T07:30:00.000Z");
});

test("isDue compares instants and tolerates missing values", () => {
  const now = new Date("2026-10-13T10:00:00.000Z");
  assert.equal(isDue("2026-10-13T09:59:00.000Z", now), true);
  assert.equal(isDue("2026-10-13T10:00:00.000Z", now), true);
  assert.equal(isDue("2026-10-13T10:01:00.000Z", now), false);
  assert.equal(isDue(null, now), false);
  assert.equal(isDue("not a date", now), false);
});

test("describeSchedule reads like a sentence for the desk", () => {
  const text = describeSchedule("0 8 * * *", "Asia/Kolkata");
  assert.ok(text.includes("Asia/Kolkata"), text);
  assert.ok(/8(:00)? ?(am|AM)?/.test(text.replace("08:00", "8")), text);
  assert.equal(describeSchedule("", "UTC"), "Manual runs only");
  assert.ok(describeSchedule("not a cron", "UTC").includes("not a cron"));
});
