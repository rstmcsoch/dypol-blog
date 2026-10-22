/** Reporting calendar. All boundaries are civil dates in Asia/Kolkata, not UTC midnights. */
export const REPORT_TZ = "Asia/Kolkata";

export const PRESETS = ["today", "yesterday", "7d", "28d", "30d", "90d", "12m", "custom"] as const;
export type Preset = (typeof PRESETS)[number];

export type DateRange = { from: string; to: string; label: string; preset: Preset };
export type Grain = "day" | "week" | "month";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function kolkataDay(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isDay(value: string): boolean {
  const m = DAY.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const utc = new Date(Date.UTC(y, mo - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === mo - 1 && utc.getUTCDate() === d;
}

export function addDays(day: string, delta: number): string {
  if (!isDay(day)) throw new Error("Invalid day");
  const [y, m, d] = day.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + delta);
  return utc.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function daysInclusive(from: string, to: string): number {
  return daysBetween(from, to) + 1;
}

export type StatsRequest = {
  preset: Preset;
  from?: string;
  to?: string;
  fresh?: boolean;
};

export function parseStatsRequest(input: unknown): StatsRequest {
  const raw = (input ?? {}) as Record<string, unknown>;
  const preset = raw.preset;
  if (typeof preset !== "string" || !(PRESETS as readonly string[]).includes(preset)) {
    throw new Error("Choose a reporting period.");
  }
  const from = typeof raw.from === "string" ? raw.from : undefined;
  const to = typeof raw.to === "string" ? raw.to : undefined;
  return { preset: preset as Preset, from, to, fresh: raw.fresh === true };
}

export function resolveRange(input: StatsRequest, now: Date = new Date()): DateRange {
  const today = kolkataDay(now);
  const span = (days: number, label: string, preset: Preset): DateRange => ({
    from: addDays(today, -(days - 1)),
    to: today,
    label,
    preset,
  });
  switch (input.preset) {
    case "today":
      return { from: today, to: today, label: "Today", preset: "today" };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y, label: "Yesterday", preset: "yesterday" };
    }
    case "7d":
      return span(7, "Last 7 days", "7d");
    case "28d":
      return span(28, "Last 28 days", "28d");
    case "30d":
      return span(30, "Last 30 days", "30d");
    case "90d":
      return span(90, "Last 90 days", "90d");
    case "12m":
      return span(365, "Last 12 months", "12m");
    case "custom": {
      if (!input.from || !input.to || !isDay(input.from) || !isDay(input.to)) {
        throw new Error("Choose a valid start and end date.");
      }
      if (input.from > input.to) throw new Error("The start date must be on or before the end date.");
      if (input.to > today) throw new Error("The end date cannot be in the future (Asia/Kolkata).");
      if (input.from < "2020-01-01") throw new Error("Dates before 2020 are not available.");
      if (daysInclusive(input.from, input.to) > 366) throw new Error("Choose a range of 366 days or fewer.");
      return { from: input.from, to: input.to, label: `${input.from} – ${input.to}`, preset: "custom" };
    }
    default:
      throw new Error("Choose a reporting period.");
  }
}

export function previousRange(range: Pick<DateRange, "from" | "to">): { from: string; to: string; label: string } {
  const n = daysInclusive(range.from, range.to);
  const to = addDays(range.from, -1);
  const from = addDays(to, -(n - 1));
  return { from, to, label: `${from} – ${to}` };
}

export function grainFor(from: string, to: string): Grain {
  const n = daysInclusive(from, to);
  if (n <= 31) return "day";
  if (n <= 120) return "week";
  return "month";
}

/** Bucket start for a civil day. Weeks are 7-day chunks from `from`, not calendar weeks. */
export function bucketStart(day: string, from: string, grain: Grain): string {
  if (grain === "day") return day;
  if (grain === "month") return `${day.slice(0, 7)}-01`;
  const offset = Math.max(0, daysBetween(from, day));
  return addDays(from, Math.floor(offset / 7) * 7);
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const n = daysInclusive(from, to);
  for (let i = 0; i < n; i += 1) out.push(addDays(from, i));
  return out;
}

export function formatRangeLabel(from: string, to: string): string {
  const fmt = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(y, m - 1, d)));
  };
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
}
