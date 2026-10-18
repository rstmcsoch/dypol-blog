/**
 * Per-profile "when should my AI app run" information.
 * The website has NO scheduler: this is guidance shown to the owner and to
 * the connected AI app. `nextExpectedRun` is computed purely from the
 * configured timezone/times/days — it is when the owner expects their AI
 * app to connect next, not a promise the site will do anything then.
 */
export const SCHEDULE_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type ScheduleDay = (typeof SCHEDULE_DAYS)[number];
export type AutomationSchedule = { timezone: string; times: string[]; days: ScheduleDay[] };

export const DEFAULT_SCHEDULE: AutomationSchedule = { timezone: "Asia/Kolkata", times: [], days: [] };

const DAY_INDEX: Record<ScheduleDay, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function wallParts(timezone: string, at: Date): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(at)) parts[p.type] = p.value;
  const wd: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute, weekday: wd[parts.weekday] ?? 0 };
}

/**
 * Next instant strictly after `now` whose wall time in `schedule.timezone`
 * matches one of `times` on one of `days` (empty days = every day).
 * Returns null when no times are configured or timezone is invalid.
 */
export function nextExpectedRun(schedule: AutomationSchedule, now: Date = new Date()): Date | null {
  if (!schedule.times.length) return null;
  try {
    wallParts(schedule.timezone, now);
  } catch {
    return null;
  }
  const allowed = schedule.days.length ? new Set(schedule.days.map((d) => DAY_INDEX[d])) : null;
  const wanted = new Set(schedule.times);
  // Wall-clock candidates repeat daily; scan minute by minute up to 8 days.
  // Start at the next whole minute so "now" itself never counts.
  const cursor = new Date(now);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  for (let i = 0; i < 8 * 24 * 60; i++) {
    const w = wallParts(schedule.timezone, cursor);
    const hhmm = `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
    if (wanted.has(hhmm) && (!allowed || allowed.has(w.weekday))) return new Date(cursor);
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}
