import { automationActive, type AutomationRecord } from "./automation.ts";
import { nextRunAfter } from "./schedule.ts";

/** ISO form of the next due time, or null for a manual-only automation. */
function nextRunFor(cron: string, timezone: string, from: Date): string | null {
  if (!cron.trim()) return null;
  const next = nextRunAfter(cron, timezone, from);
  return next ? next.toISOString() : null;
}

/**
 * The decisions a scheduler tick makes, separated from the work it does.
 *
 * The plan is pure: given the automations, the stored schedule rows and the
 * clock, it says which schedule rows must be written first and which
 * automations may run. `scheduler.server.ts` then performs exactly those
 * actions — so a test can prove the ordering rules (advance before running,
 * never run a locked automation, cap the work per tick) without D1 or a
 * provider.
 *
 * The stored fields the planner needs. `ScheduleState` in store.server.ts is
 * structurally compatible, which keeps this module free of database imports.
 */
export type PlannedSchedule = {
  nextRunAt: string | null;
  lockedUntil: string | null;
  failureStreak: number;
};

export type TickPlan = {
  /** Schedule rows to write before anything runs (slot advance, idle drift). */
  prepare: { automationId: string; nextRunAt: string | null; failureStreak?: number }[];
  /** Automations that may run now, in order, already bounded by the limit. */
  run: { automation: AutomationRecord; attempt: number; nextRunAt: string | null }[];
  skipped: { automationId: string; name: string; reason: string }[];
};

export const DEFAULT_TICK_LIMIT = 3;

/**
 * A tick never runs more than `limit` automations, and it advances each slot
 * before the run so a crash, timeout or deploy cannot replay the same slot and
 * write the same article twice.
 */
export function planTick(input: {
  automations: AutomationRecord[];
  schedules: Map<string, Pick<PlannedSchedule, "nextRunAt" | "lockedUntil" | "failureStreak">>;
  now: Date;
  limit?: number;
}): TickPlan {
  const { automations, schedules, now } = input;
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_TICK_LIMIT, 10));
  const plan: TickPlan = { prepare: [], run: [], skipped: [] };
  const nowMs = now.getTime();

  for (const automation of automations) {
    if (plan.run.length >= limit) break;
    const cron = automation.scheduleCron.trim();
    if (!cron) continue; // Manual-only automations keep their stored row untouched.
    const state = schedules.get(automation.id);

    if (!automationActive(automation).active) {
      // Keep the stored time current so re-enabling does not fire a stale slot,
      // and forget the failure streak: the owner has paused it.
      const next = nextRunFor(automation.scheduleCron, automation.timezone, now);
      if (state?.nextRunAt !== next || (state?.failureStreak ?? 0) !== 0) {
        plan.prepare.push({ automationId: automation.id, nextRunAt: next, failureStreak: 0 });
      }
      continue;
    }

    const nextRunAt = state?.nextRunAt ?? nextRunFor(automation.scheduleCron, automation.timezone, now);
    if (!nextRunAt || Date.parse(nextRunAt) > nowMs) continue; // Not due yet.

    if (state?.lockedUntil && Date.parse(state.lockedUntil) > nowMs) {
      plan.skipped.push({ automationId: automation.id, name: automation.name, reason: "Already running." });
      continue;
    }

    const following = nextRunFor(automation.scheduleCron, automation.timezone, now) ?? nextRunAt;
    const attempt = Math.min(1 + (state?.failureStreak ?? 0), automation.retryMax + 1);
    plan.prepare.push({ automationId: automation.id, nextRunAt: following });
    plan.run.push({ automation, attempt, nextRunAt: following });
  }

  return plan;
}

/**
 * Where the slot goes after a run: the retry backoff while the streak is inside
 * the automation's own retry budget, otherwise the next scheduled slot.
 */
export function nextRunAfterOutcome(input: {
  automation: Pick<AutomationRecord, "scheduleCron" | "timezone" | "retryMax" | "retryBackoffSeconds">;
  now: Date;
  failed: boolean;
  streak: number;
}): string | null {
  const { automation, now, failed, streak } = input;
  if (failed && automation.retryMax > 0 && streak <= automation.retryMax) {
    return new Date(now.getTime() + automation.retryBackoffSeconds * 1000 * streak).toISOString();
  }
  return nextRunFor(automation.scheduleCron, automation.timezone, now);
}
