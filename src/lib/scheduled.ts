/**
 * t214: Worker cron dispatch (pure, testable). Only the events clean-up is scheduled; any other
 * cron expression is ignored so future triggers can't run it by accident.
 */
export const EVENTS_CLEANUP_CRON = "17 * * * *";

export type ScheduledDeps = {
  sweepEvents: (now: number) => Promise<number>;
  log?: (line: string) => void;
};

export async function dispatchScheduled(cron: string, scheduledTime: number, deps: ScheduledDeps): Promise<{ ran: string[]; removed: number }> {
  const log = deps.log ?? ((line: string) => console.log(line));
  if (cron !== EVENTS_CLEANUP_CRON) {
    log(`[cron] ignored unknown schedule ${cron}`);
    return { ran: [], removed: 0 };
  }
  try {
    const removed = await deps.sweepEvents(scheduledTime);
    log(`[cron] events clean-up at ${new Date(scheduledTime).toISOString()}: removed ${removed}`);
    return { ran: ["events-cleanup"], removed };
  } catch (error) {
    log(`[cron] events clean-up failed: ${error instanceof Error ? error.message : String(error)}`);
    return { ran: ["events-cleanup"], removed: 0 };
  }
}
