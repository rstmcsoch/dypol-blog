/**
 * t214: Worker entry = TanStack Start's generated handler (unchanged for every request) plus a
 * `scheduled` handler for the hourly events clean-up (expired events deleted 7 days after end/edit).
 */
import handler from "@tanstack/react-start/server-entry";
import { dispatchScheduled } from "@/lib/scheduled";

type Ctx = { waitUntil(promise: Promise<unknown>): void };
type Controller = { cron: string; scheduledTime: number };

export default {
  fetch(...args: Parameters<typeof handler.fetch>) {
    return handler.fetch(...args);
  },
  async scheduled(controller: Controller, _env: unknown, ctx: Ctx) {
    ctx.waitUntil(
      dispatchScheduled(controller.cron, controller.scheduledTime, {
        sweepEvents: async (now) => (await import("@/content/events.server")).sweepExpiredEvents(now),
      }),
    );
  },
};
