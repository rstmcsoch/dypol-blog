import { workerEnv } from "@/lib/cf-env.server";
import { writesAllowed } from "@/lib/write-guard.server";
import { executeAutomation, type RunOutcome } from "./run.server";
import { productionDeps } from "./runner.server";
import {
  claimRun,
  listAutomations,
  nextRunFor,
  readSchedules,
  recordRun,
  releaseRun,
  setSchedule,
} from "./store.server";
import { nextRunAfterOutcome, planTick } from "./tick-plan.ts";

/**
 * The scheduler.
 *
 * Triggers:
 *  - Cloudflare Cron Trigger → the Worker's `scheduled` handler (src/worker-entry.ts).
 *  - The token-protected tick endpoint (/api/automation/tick) for an external
 *    cron or a manual nudge.
 *
 * Guarantees:
 *  - `next_run_at` is advanced **before** a run starts, so a crash, timeout or
 *    deployment cannot replay the same slot and duplicate an article.
 *  - One automation can never run twice at once: the claim is a single
 *    conditional UPDATE on automation_schedule.
 *  - A run that produces an article already recorded for that slot is skipped
 *    (idempotency key + content hash in automation_submissions).
 *  - Failures are retried with backoff up to the automation's own limit, then
 *    the streak is recorded and surfaced in the desk.
 */

export const MAX_RUNS_PER_TICK = 3;
const LOCK_SECONDS = 600;

export type TickResult = {
  ran: { automationId: string; name: string; outcome: RunOutcome }[];
  skipped: { automationId: string; name: string; reason: string }[];
  checkedAt: string;
};

function envRecord(env: unknown): Record<string, string | undefined> {
  return (env ?? {}) as Record<string, string | undefined>;
}

/** One automation, run because its schedule is due. */
export async function runAutomationById(
  id: string,
  options: { trigger: "schedule" | "manual" | "retry" | "test"; dryRun?: boolean; now?: Date } = { trigger: "manual" },
): Promise<RunOutcome | null> {
  const now = options.now ?? new Date();
  const automations = await listAutomations();
  const automation = automations.find((item) => item.id === id);
  if (!automation) return null;
  const env = envRecord(await workerEnv());
  const deps = await productionDeps();
  const token = await claimRun(id, now, LOCK_SECONDS);
  if (!token) {
    return {
      status: "skipped",
      stage: "config",
      reason: "This automation is already running (or was claimed by another scheduler tick).",
      articleId: null,
      slug: null,
      attempt: 1,
      durationMs: 0,
      flags: [],
      published: false,
    };
  }
  try {
    const schedules = await readSchedules();
    const previous = schedules.get(id);
    const attempt = Math.min(1 + (previous?.failureStreak ?? 0), automation.retryMax + 1);
    return await executeAutomation({
      automation,
      env,
      trigger: options.trigger,
      dryRun: options.dryRun,
      attempt,
      deps,
      now,
    });
  } finally {
    await releaseRun(id, token);
  }
}

/** Every automation whose stored schedule is due, bounded per tick. */
export async function runDueAutomations(options: { now?: Date; limit?: number } = {}): Promise<TickResult> {
  const now = options.now ?? new Date();
  const checkedAt = now.toISOString();
  const result: TickResult = { ran: [], skipped: [], checkedAt };

  if (!(await writesAllowed())) {
    result.skipped.push({ automationId: "*", name: "*", reason: "This deployment is read-only; scheduled runs are disabled." });
    return result;
  }

  // Decide first (pure), then act. The plan advances every due slot before a
  // single provider call, so a crash or a deploy cannot replay a slot.
  const automations = await listAutomations();
  const schedules = await readSchedules();
  const plan = planTick({ automations, schedules, now, limit: options.limit });

  for (const step of plan.prepare) {
    await setSchedule(step.automationId, {
      nextRunAt: step.nextRunAt,
      ...(step.failureStreak === undefined ? {} : { failureStreak: step.failureStreak }),
    });
  }
  result.skipped.push(...plan.skipped);
  if (plan.run.length === 0) return result;

  const env = envRecord(await workerEnv());
  const deps = await productionDeps();

  for (const step of plan.run) {
    const automation = step.automation;
    const state = schedules.get(automation.id);
    const token = await claimRun(automation.id, now, LOCK_SECONDS);
    if (!token) {
      result.skipped.push({ automationId: automation.id, name: automation.name, reason: "Another tick claimed it first." });
      continue;
    }
    let outcome: RunOutcome;
    try {
      outcome = await executeAutomation({ automation, env, trigger: "schedule", attempt: step.attempt, deps, now });
    } catch (error) {
      outcome = {
        status: "failed",
        stage: "config",
        reason: error instanceof Error ? error.message.slice(0, 300) : "Unknown scheduler error.",
        articleId: null,
        slug: null,
        attempt: step.attempt,
        durationMs: 0,
        flags: [],
        published: false,
      };
      await recordRun({
        automationId: automation.id,
        tool: "scheduled_run",
        outcome: "failed",
        status: "failed",
        stage: outcome.stage,
        reason: outcome.reason,
        auth: "scheduler",
        durationMs: 0,
        attempt: step.attempt,
      });
    } finally {
      await releaseRun(automation.id, token);
    }

    const failed = outcome.status === "failed";
    const streak = failed ? (state?.failureStreak ?? 0) + 1 : 0;
    await setSchedule(automation.id, {
      nextRunAt: nextRunAfterOutcome({ automation, now, failed, streak }),
      lastRunAt: now.toISOString(),
      lastStatus: outcome.status,
      lastReason: outcome.reason.slice(0, 300),
      failureStreak: streak,
    });
    result.ran.push({ automationId: automation.id, name: automation.name, outcome });
  }
  return result;
}

/** Recomputes stored next-run times (used after a schedule edit or deploy). */
export async function refreshSchedules(now = new Date()): Promise<void> {
  const automations = await listAutomations();
  for (const automation of automations) {
    if (!automation.scheduleCron.trim()) {
      await setSchedule(automation.id, { nextRunAt: null });
      continue;
    }
    await setSchedule(automation.id, {
      nextRunAt: nextRunFor(automation.scheduleCron, automation.timezone, now),
      failureStreak: 0,
    });
  }
}
