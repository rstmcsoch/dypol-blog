import { isValidTimeZone } from "./timezone.ts";

/**
 * Cron + timezone maths for automation schedules. Pure (Intl only), so it runs
 * in workerd, in node tests, and in the desk preview.
 *
 * A stored schedule is always a 5-field cron expression **plus** an IANA
 * timezone. Nothing here depends on the runtime's own timezone, so a Worker
 * always computes the same next run for the same schedule.
 */

export type CronSpec = {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  dayOfMonthRestricted: boolean;
  dayOfWeekRestricted: boolean;
};

const RANGES: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function expandField(field: string, index: number): number[] | null {
  const [min, max] = RANGES[index] as [number, number];
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const piece = part.trim();
    if (!piece) return null;
    const [rangeText, stepText] = piece.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;
    let from = min;
    let to = max;
    if (rangeText !== "*") {
      const bounds = (rangeText as string).split("-");
      from = Number(bounds[0]);
      to = bounds.length > 1 ? Number(bounds[1] as string) : Number(bounds[0]);
      if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
      // A plain range (9-17) keeps both ends; a bare number (8) already has
      // from === to, so nothing needs collapsing here.
    }
    if (from < min || to > max || from > to) return null;
    for (let value = from; value <= to; value += step) out.add(value);
  }
  if (out.size === 0) return null;
  const list = [...out].sort((a, b) => a - b);
  if (index === 4) {
    // cron allows 7 = Sunday; normalise to 0.
    const normalised = new Set(list.map((value) => (value === 7 ? 0 : value)));
    return [...normalised].sort((a, b) => a - b);
  }
  return list;
}

export function parseCron(expr: string): CronSpec | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const spec: CronSpec = {
    minutes: [],
    hours: [],
    daysOfMonth: [],
    months: [],
    daysOfWeek: [],
    dayOfMonthRestricted: parts[2] !== "*",
    dayOfWeekRestricted: parts[4] !== "*",
  };
  const minutes = expandField(parts[0] as string, 0);
  const hours = expandField(parts[1] as string, 1);
  const daysOfMonth = expandField(parts[2] as string, 2);
  const months = expandField(parts[3] as string, 3);
  const daysOfWeek = expandField(parts[4] as string, 4);
  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null;
  spec.minutes = minutes;
  spec.hours = hours;
  spec.daysOfMonth = daysOfMonth;
  spec.months = months;
  spec.daysOfWeek = daysOfWeek;
  return spec;
}

export type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

function partsInZone(date: Date, timeZone: string): WallClock & { second: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const hour = read("hour");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // Intl can emit 24 for midnight in some engines.
    hour: hour === 24 ? 0 : hour,
    minute: read("minute"),
    second: read("second"),
  };
}

const wallToUtcMs = (wall: WallClock, second = 0): number =>
  Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, second);

/** Offset (ms) of `timeZone` at the given instant: local wall clock minus UTC. */
function zoneOffset(instantMs: number, timeZone: string): number {
  const wall = partsInZone(new Date(instantMs), timeZone);
  return wallToUtcMs(wall, wall.second) - instantMs;
}

/** A local wall-clock time in `timeZone` as a UTC instant (two-pass offset resolution). */
export function zonedTimeToUtc(wall: WallClock, timeZone: string): Date {
  const guess = wallToUtcMs(wall);
  const first = guess - zoneOffset(guess, timeZone);
  const second = guess - zoneOffset(first, timeZone);
  return new Date(second);
}

function matchesDay(spec: CronSpec, year: number, month: number, day: number): boolean {
  if (!spec.months.includes(month)) return false;
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const dom = spec.daysOfMonth.includes(day);
  const dow = spec.daysOfWeek.includes(dayOfWeek);
  if (spec.dayOfMonthRestricted && spec.dayOfWeekRestricted) return dom || dow;
  return dom && dow;
}

/** The first instant strictly after `from` that matches the schedule, or null. */
export function nextRunAfter(cron: string, timeZone: string, from: Date): Date | null {
  const spec = parseCron(cron);
  if (!spec) return null;
  if (!isValidTimeZone(timeZone)) return null;
  const start = partsInZone(from, timeZone);
  const startDay = Date.UTC(start.year, start.month - 1, start.day);
  const fromMs = from.getTime();
  for (let offset = 0; offset <= 400; offset += 1) {
    const civil = new Date(startDay + offset * 86_400_000);
    const year = civil.getUTCFullYear();
    const month = civil.getUTCMonth() + 1;
    const day = civil.getUTCDate();
    if (!matchesDay(spec, year, month, day)) continue;
    for (const hour of spec.hours) {
      for (const minute of spec.minutes) {
        const candidate = zonedTimeToUtc({ year, month, day, hour, minute }, timeZone);
        if (candidate.getTime() > fromMs) return candidate;
      }
    }
  }
  return null;
}

/** True when the schedule has a run due at or before `now` and one is not already recorded. */
export function isDue(nextRunAt: string | null | undefined, now: Date): boolean {
  if (!nextRunAt) return false;
  const at = Date.parse(nextRunAt);
  return Number.isFinite(at) && at <= now.getTime();
}

const HOUR_WORDS: Record<string, string> = {};

/** A human sentence for the schedule, used by the desk. */
export function describeSchedule(cron: string, timeZone: string): string {
  if (!cron.trim()) return "Manual runs only";
  const spec = parseCron(cron);
  if (!spec) return `Custom schedule (${cron})`;
  const time = spec.minutes
    .map((minute) => spec.hours.map((hour) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`))
    .flat()
    .slice(0, 4)
    .map((clock) => (HOUR_WORDS[clock] ?? clock))
    .join(", ");
  const everyDay = !spec.dayOfMonthRestricted && !spec.dayOfWeekRestricted && spec.months.length === 12;
  const prefix = everyDay ? "Every day" : "On the selected days";
  const more = spec.minutes.length * spec.hours.length > 4 ? " …" : "";
  return `${prefix} at ${time}${more} (${timeZone})`;
}

/** Minutes since midnight, used for ordering and display of daily runs. */
export function defaultScheduleForIndex(index: number): string {
  const hour = 8 + (index % 3) * 5;
  return `0 ${hour} * * *`;
}
