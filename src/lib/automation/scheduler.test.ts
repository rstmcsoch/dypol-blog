import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_AUTOMATION_INPUT, automationInputSchema, type AutomationRecord } from "./automation.ts";
import { nextRunAfter } from "./schedule.ts";
import { nextRunAfterOutcome, planTick, type PlannedSchedule } from "./tick-plan.ts";

/**
 * Scheduler rules, tested without D1 or a provider: the plan is pure, so these
 * assertions cover the parts that decide whether an article can be written
 * twice (slot advance ordering, locks, the per-tick limit).
 */

const NOW = new Date("2026-10-13T12:00:30.000Z");

function automation(patch: Partial<AutomationRecord> = {}): AutomationRecord {
  const parsed = automationInputSchema.parse({
    ...DEFAULT_AUTOMATION_INPUT,
    name: patch.name ?? "Desk automation",
    enabled: true,
    mode: "server-api",
    provider: "openai",
    credentialRef: "AUTOMATION_A_KEY",
    topicIdeas: ["Edge inference"],
    scheduleCron: "*/30 * * * *",
    timezone: "UTC",
  });
  return { ...parsed, id: "a1", sortOrder: 0, createdAt: "", updatedAt: "", ...patch };
}

const schedule = (patch: Partial<PlannedSchedule> = {}): PlannedSchedule => ({
  nextRunAt: null,
  lockedUntil: null,
  failureStreak: 0,
  ...patch,
});

test("an automation that is not due yet is left alone", () => {
  const due = automation({ id: "due" });
  const later = automation({ id: "later" });
  const plan = planTick({
    automations: [later],
    schedules: new Map([[later.id, schedule({ nextRunAt: "2026-10-13T12:30:00.000Z" })]]),
    now: NOW,
  });
  assert.deepEqual(plan.run.map((step) => step.automation.id), []);
  assert.deepEqual(plan.prepare, []);
  assert.deepEqual(plan.skipped, []);
  // The due one, for contrast, is picked up.
  const duePlan = planTick({
    automations: [due],
    schedules: new Map([[due.id, schedule({ nextRunAt: "2026-10-13T12:00:00.000Z" })]]),
    now: NOW,
  });
  assert.deepEqual(duePlan.run.map((step) => step.automation.id), ["due"]);
});

test("the slot is advanced before the run, so a crash cannot replay it", () => {
  const item = automation();
  const plan = planTick({
    automations: [item],
    schedules: new Map([[item.id, schedule({ nextRunAt: "2026-10-13T12:00:00.000Z" })]]),
    now: NOW,
  });
  assert.equal(plan.prepare.length, 1);
  assert.equal(plan.prepare[0].automationId, "a1");
  assert.equal(plan.prepare[0].nextRunAt, "2026-10-13T12:30:00.000Z", "advanced to the following slot");
  assert.equal(plan.run.length, 1);
  assert.equal(plan.run[0].nextRunAt, plan.prepare[0].nextRunAt);
  assert.equal(plan.run[0].attempt, 1);
});

test("a locked automation is skipped and its slot is NOT advanced", () => {
  const item = automation();
  const plan = planTick({
    automations: [item],
    schedules: new Map([
      [item.id, schedule({ nextRunAt: "2026-10-13T12:00:00.000Z", lockedUntil: "2026-10-13T12:10:00.000Z" })],
    ]),
    now: NOW,
  });
  assert.deepEqual(plan.run, []);
  assert.deepEqual(plan.prepare, [], "the slot still belongs to the run that holds the lock");
  assert.deepEqual(plan.skipped, [{ automationId: "a1", name: item.name, reason: "Already running." }]);
});

test("an expired lock does not block the run", () => {
  const item = automation();
  const plan = planTick({
    automations: [item],
    schedules: new Map([
      [item.id, schedule({ nextRunAt: "2026-10-13T12:00:00.000Z", lockedUntil: "2026-10-13T11:55:00.000Z" })],
    ]),
    now: NOW,
  });
  assert.equal(plan.run.length, 1);
});

test("a paused automation is never run, and its stored time is kept current", () => {
  const item = automation({ paused: true });
  const plan = planTick({
    automations: [item],
    schedules: new Map([[item.id, schedule({ nextRunAt: "2026-10-01T00:00:00.000Z", failureStreak: 3 })]]),
    now: NOW,
  });
  assert.deepEqual(plan.run, []);
  assert.equal(plan.prepare[0].nextRunAt, "2026-10-13T12:30:00.000Z", "re-enabling must not fire a stale slot");
  assert.equal(plan.prepare[0].failureStreak, 0);
});

test("a manual-only automation is untouched", () => {
  const item = automation({ scheduleCron: "" });
  const plan = planTick({ automations: [item], schedules: new Map(), now: NOW });
  assert.deepEqual(plan.run, []);
  assert.deepEqual(plan.prepare, []);
});

test("one tick runs at most `limit` automations and leaves the rest for the next tick", () => {
  const items = ["a", "b", "c"].map((id) => automation({ id, name: `Desk ${id}` }));
  const schedules = new Map(items.map((item) => [item.id, schedule({ nextRunAt: "2026-10-13T12:00:00.000Z" })]));
  const plan = planTick({ automations: items, schedules, now: NOW, limit: 2 });
  assert.deepEqual(plan.run.map((step) => step.automation.id), ["a", "b"]);
  assert.deepEqual(plan.prepare.map((step) => step.automationId), ["a", "b"], "c keeps its slot for the next tick");
  const capped = planTick({ automations: items, schedules, now: NOW, limit: 99 });
  assert.equal(capped.run.length, 3, "the limit is clamped, not ignored");
});

test("the attempt number follows the failure streak, inside the automation's own budget", () => {
  const item = automation({ retryMax: 2 });
  const first = planTick({
    automations: [item],
    schedules: new Map([[item.id, schedule({ nextRunAt: "2026-10-13T12:00:00.000Z", failureStreak: 1 })]]),
    now: NOW,
  });
  assert.equal(first.run[0].attempt, 2);
  const exhausted = planTick({
    automations: [item],
    schedules: new Map([[item.id, schedule({ nextRunAt: "2026-10-13T12:00:00.000Z", failureStreak: 9 })]]),
    now: NOW,
  });
  assert.equal(exhausted.run[0].attempt, 3, "never more than retryMax + 1");
});

test("a failure retries on the backoff, then falls back to the next slot", () => {
  const item = automation({ retryMax: 1, retryBackoffSeconds: 120 });
  const retry = nextRunAfterOutcome({ automation: item, now: NOW, failed: true, streak: 1 });
  assert.equal(retry, "2026-10-13T12:02:30.000Z");
  const giveUp = nextRunAfterOutcome({ automation: item, now: NOW, failed: true, streak: 2 });
  assert.equal(giveUp, "2026-10-13T12:30:00.000Z");
  const ok = nextRunAfterOutcome({ automation: item, now: NOW, failed: false, streak: 0 });
  assert.equal(ok, "2026-10-13T12:30:00.000Z");
});

test("the plan matches the cron the desk displays (next run is tz-aware)", () => {
  const item = automation({ scheduleCron: "0 9 * * *", timezone: "Asia/Tokyo" });
  const plan = planTick({
    automations: [item],
    schedules: new Map([[item.id, schedule({ nextRunAt: "2026-10-13T00:00:00.000Z" })]]),
    now: NOW,
  });
  // 09:00 in Tokyo on the 14th is 00:00 UTC on the 14th, and the desk shows the
  // same instant that the planner advanced to.
  assert.equal(plan.prepare[0].nextRunAt, nextRunAfter("0 9 * * *", "Asia/Tokyo", NOW)?.toISOString());
  assert.equal(plan.prepare[0].nextRunAt, "2026-10-14T00:00:00.000Z");
});
