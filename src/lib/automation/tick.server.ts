import { workerEnv } from "../cf-env.server";
import { runAutomationById, runDueAutomations } from "./scheduler.server";
import { tickAuthorised, tickConfigured } from "./tick-auth.ts";

/**
 * HTTP entry point for the scheduler (see src/routes/api.automation.tick.ts).
 * The response never contains credentials, configuration or article bodies —
 * only per-automation status, stage and a short reason.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export async function handleTick(request: Request): Promise<Response> {
  const env = (await workerEnv()) as unknown as Record<string, string | undefined>;
  if (!tickConfigured(env)) {
    return json({ ok: false, error: "Scheduling is disabled: set CRON_SECRET (or MCP_TOKEN) as a Worker secret." }, 503);
  }
  const who = await tickAuthorised(request.headers.get("authorization"), env);
  if (!who) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized." }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "www-authenticate": 'Bearer realm="dypolblog"' },
    });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const automationId = url.searchParams.get("automation");
  const force = url.searchParams.get("force") === "1";

  try {
    if (automationId) {
      const outcome = await runAutomationById(automationId, { trigger: force ? "manual" : "schedule", dryRun });
      if (!outcome) return json({ ok: false, error: "That automation does not exist." }, 404);
      return json({ ok: outcome.status !== "failed", trigger: who, outcome });
    }
    if (force) {
      // "Run every scheduled automation once, now": used to verify a setup.
      const { listAutomations } = await import("./store.server");
      const automations = await listAutomations();
      const results = [];
      for (const automation of automations) {
        if (!automation.enabled || automation.paused || !automation.scheduleCron) continue;
        const outcome = await runAutomationById(automation.id, { trigger: "manual", dryRun });
        if (outcome) results.push({ automationId: automation.id, name: automation.name, outcome });
      }
      return json({ ok: results.every((item) => item.outcome.status !== "failed"), trigger: who, forced: true, results });
    }
    const result = await runDueAutomations();
    return json({ ok: true, trigger: who, checkedAt: result.checkedAt, ran: result.ran, skipped: result.skipped });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message.slice(0, 300) : "Scheduler error." }, 500);
  }
}
