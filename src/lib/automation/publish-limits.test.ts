import assert from "node:assert/strict";
import test from "node:test";
import { effectiveRun, limitVerdict, sanitizeRunId } from "./publish-limits.ts";
import { normalizeAutomationSettings, DEFAULT_AUTOMATION_SETTINGS } from "./settings.ts";
import { publishDecision } from "./policy.ts";

const policy = DEFAULT_AUTOMATION_SETTINGS.policy;
const at = (iso: string) => iso;

test("t64 migration: stored maxPublishedPerDay becomes maxPublishedPerRun", () => {
  const out = normalizeAutomationSettings({ policy: { maxPublishedPerDay: 2 } });
  assert.equal(out.policy.maxPublishedPerRun, 2);
  const explicit = normalizeAutomationSettings({ policy: { maxPublishedPerDay: 5, maxPublishedPerRun: 3 } });
  assert.equal(explicit.policy.maxPublishedPerRun, 3);
  const fresh = normalizeAutomationSettings({});
  assert.equal(fresh.policy.maxPublishedPerRun, DEFAULT_AUTOMATION_SETTINGS.policy.maxPublishedPerRun);
});

test("per-run cap blocks the (N+1)th publish in the same run_id; a new run resets", () => {
  const usage = [
    { createdAt: at("2026-10-18T04:00:00Z"), runKey: "run:default:morning-1", profileId: "default" },
    { createdAt: at("2026-10-18T04:05:00Z"), runKey: "run:default:morning-1", profileId: "default" },
  ];
  const same = effectiveRun("default", "morning-1", usage, new Date("2026-10-18T04:10:00Z"));
  assert.equal(same.used, 2);
  assert.equal(limitVerdict({ websiteUsed: 2, websiteCap: 0, runUsed: same.used, runCap: 2 }).blocked, true);
  // publishDecision (automatic path) agrees: the 3rd in the run stays a draft.
  const decision = publishDecision({
    active: { active: true, reason: null },
    policy: { ...policy, autoPublish: true, allowedCategoryIds: [], maxPublishedPerRun: 2 },
    status: "draft",
    categoryIds: ["ai"],
    flags: [],
    publishedThisRun: same.used,
  });
  assert.equal(decision.publish, false);

  const fresh = effectiveRun("default", "evening-1", usage, new Date("2026-10-18T12:00:00Z"));
  assert.equal(fresh.used, 0);
  assert.equal(limitVerdict({ websiteUsed: 2, websiteCap: 0, runUsed: fresh.used, runCap: 2 }).blocked, false);
});

test("burst fallback: publishes within 30 minutes share one run; silence resets it", () => {
  const usage = [
    { createdAt: at("2026-10-18T04:00:00Z"), runKey: null, profileId: "default" },
    { createdAt: at("2026-10-18T04:20:00Z"), runKey: null, profileId: "default" },
    { createdAt: at("2026-10-18T01:00:00Z"), runKey: null, profileId: "default" },
  ];
  const inBurst = effectiveRun("default", null, usage, new Date("2026-10-18T04:35:00Z"));
  assert.equal(inBurst.source, "burst");
  assert.equal(inBurst.used, 2);
  const afterSilence = effectiveRun("default", null, usage, new Date("2026-10-18T05:30:00Z"));
  assert.equal(afterSilence.used, 0);
});

test("website cap counts across profiles and blocks auto + explicit (same verdict)", () => {
  // Two profiles each under their per-run cap; website total at cap.
  const verdict = limitVerdict({ websiteUsed: 4, websiteCap: 4, runUsed: 1, runCap: 2 });
  assert.equal(verdict.blocked, true);
  assert.match(verdict.websiteReason ?? "", /Website daily publish limit reached \(4\)/);
  // 0 means unlimited on both tiers.
  assert.equal(limitVerdict({ websiteUsed: 99, websiteCap: 0, runUsed: 99, runCap: 0 }).blocked, false);
  // Per-run still blocks when the website has room.
  const runOnly = limitVerdict({ websiteUsed: 1, websiteCap: 10, runUsed: 2, runCap: 2 });
  assert.equal(runOnly.blocked, true);
  assert.match(runOnly.runReason ?? "", /Per-run publish limit reached \(2\)/);
});

test("run ids are sanitized and short/garbage ids fall back to burst", () => {
  assert.equal(sanitizeRunId("morning run! 2026"), "morning-run--2026");
  assert.equal(sanitizeRunId("ab"), null);
  assert.equal(effectiveRun("p", "ab", []).source, "burst");
});
