import handler from "@tanstack/react-start/server-entry";

/**
 * The Worker entry.
 *
 * Everything the app does over HTTP goes to TanStack Start's own handler; the
 * only addition is the Cloudflare **Cron Trigger** entry point, which is how
 * automations get their schedule without a second service, a queue or a
 * container. Cron triggers are declared in wrangler.jsonc (`triggers.crons`)
 * and are free with Workers.
 *
 * A cron tick is deliberately tiny: it reads the stored schedules from D1 and
 * runs only the automations that are due. All of the real work (and all of the
 * duplicate protection) lives in src/lib/automation/scheduler.server.ts.
 */

type Env = Record<string, unknown>;
type ExecutionCtx = { waitUntil(promise: Promise<unknown>): void };

type CronEvent = { cron?: string; scheduledTime?: number };

const entry = {
  async fetch(request: Request, env: Env, ctx: ExecutionCtx): Promise<Response> {
    return (handler as { fetch: (request: Request, env: Env, ctx: ExecutionCtx) => Promise<Response> }).fetch(request, env, ctx);
  },

  async scheduled(event: CronEvent, env: Env, ctx: ExecutionCtx): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const { runDueAutomations } = await import("@/lib/automation/scheduler.server");
        try {
          const result = await runDueAutomations();
          if (result.ran.length > 0 || result.skipped.length > 0) {
            console.log(
              JSON.stringify({
                event: "cron-tick",
                cron: event?.cron ?? "",
                ran: result.ran.map((item) => ({ id: item.automationId, status: item.outcome.status, stage: item.outcome.stage })),
                skipped: result.skipped.length,
              }),
            );
          }
        } catch (error) {
          // Never throw out of a scheduled handler: the tick simply ends and the
          // next tick retries, because next_run_at was already advanced.
          console.error("[cron] automation tick failed", error instanceof Error ? error.message : "unknown");
        }
      })(),
    );
  },
};

export default entry;
