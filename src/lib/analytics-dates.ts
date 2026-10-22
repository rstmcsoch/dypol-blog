/**
 * Reporting calendar for the Stats dashboard.
 *
 * All dates are Asia/Kolkata calendar dates (UTC+5:30), the default reporting
 * timezone for DYPOL Blog. Timestamps in the database are ISO-8601 UTC; a
 * Kolkata date is derived from them at insert time and in queries (via the
 * `+5 hours, +30 minutes` strftime modifiers) so every report uses one
 * stable, documented calendar.
 *
 * This module is pure: no DOM, no network, safe to import in tests.
 */

export const REPORTING_TIMEZONE = "Asia/Kolkata";

/** Kolkata offset from UTC, in minutes (+330). Fixed year-round (no DST). */
export const KOLKATA_OFFSET_MINUTES = 5 * 60 + 30;

/**
 * Convert a UTC instant to the Asia/Kolkata calendar date (YYYY-MM-DD).
 */
export function kolkataDate(utcIso: string): string {
  const ms = Date.parse(utcIso);
  if (Number.isNaN(ms)) throw new Error(`Invalid UTC timestamp: ${utcIso}`);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** Format a UTC instant as a short Kolkata date for UI display (e.g. 22 Oct). */
export function kolkataDisplayDate(utcIso: string): string {
  const ms = Date.parse(utcIso);
  if (Number.isNaN(ms)) return utcIso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORTING_TIMEZONE,
    day: "numeric",
    month: "short",
  }).format(new Date(ms));
}

/** Format a UTC instant as Kolkata time (e.g. 14:30 IST). */
export function kolkataTime(utcIso: string): string {
  const ms = Date.parse(utcIso);
  if (Number.isNaN(ms)) return utcIso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORTING_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(ms));
}

/**
 * Start of a Kolkata calendar date, as a UTC ISO string (midnight Kolkata =
 * 18:30 previous day UTC).
 */
export function kolkataDayStartUtc(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const kolkataMs = new Date(Date.UTC(y, m - 1, d)).getTime();
  return new Date(kolkataMs - KOLKATA_OFFSET_MINUTES * 60 * 1000).toISOString();
}

/** Today's date in Asia/Kolkata. */
export function todayKolkata(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Subtract calendar days from a YYYY-MM-DD date (Kolkata calendar math). */
export function kolkataAddDays(yyyymmdd: string, days: number): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const ms = new Date(Date.UTC(y, m - 1, d + days)).getTime();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export type DatePreset =
  | "today"
  | "yesterday"
  | "last-7"
  | "last-28"
  | "last-30"
  | "last-90"
  | "last-12-months"
  | "custom";

export type Period = {
  preset: DatePreset;
  from: string;       // inclusive Kolkata date
  to: string;         // inclusive Kolkata date
  label: string;
  fromLabel: string;  // UI: e.g. "1 Oct 2026"
  toLabel: string;
  previousFrom: string; // inclusive Kolkata date, same length as [from, to]
  previousTo: string;
  granularity: "day" | "week" | "month";
  days: number;       // calendar days in [from, to], inclusive
};

/** Preset labels shown in the global filter bar. */
export const PRESET_LABELS: Record<DatePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "last-7": "Last 7 days",
  "last-28": "Last 28 days",
  "last-30": "Last 30 days",
  "last-90": "Last 90 days",
  "last-12-months": "Last 12 months",
  custom: "Custom range",
};

/** Days spanned by each fixed preset (inclusive). */
const PRESET_DAYS: Record<DatePreset, number> = {
  today: 1,
  yesterday: 1,
  "last-7": 7,
  "last-28": 28,
  "last-30": 30,
  "last-90": 90,
  "last-12-months": 365,
  custom: 30,
};

/**
 * Compute a reporting period from the selected preset (and optional custom
 * bounds). The "to" date is inclusive; never later than today.
 */
export function computePeriod(
  preset: DatePreset,
  custom?: { from: string; to: string } | null,
): Period {
  const today = todayKolkata();

  let from: string;
  let to: string;
  let label: string;

  if (preset === "custom" && custom) {
    from = custom.from;
    to = custom.to;
    label = PRESET_LABELS.custom;
  } else if (preset === "today") {
    from = today;
    to = today;
    label = PRESET_LABELS.today;
  } else if (preset === "yesterday") {
    from = kolkataAddDays(today, -1);
    to = kolkataAddDays(today, -1);
    label = PRESET_LABELS.yesterday;
  } else {
    const days = PRESET_DAYS[preset as keyof typeof PRESET_DAYS];
    from = kolkataAddDays(today, -(days - 1));
    to = today;
    label = PRESET_LABELS[preset];
  }

  // Clamp "to" to today (a custom range must not reach into the future).
  if (to > today) to = today;
  if (from > to) from = to;

  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
  const previousTo = kolkataAddDays(from, -1);
  const previousFrom = kolkataAddDays(previousTo, -(days - 1));

  let granularity: "day" | "week" | "month" = "day";
  if (days > 90) granularity = "month";
  else if (days > 31) granularity = "week";

  return {
    preset,
    from,
    to,
    label,
    fromLabel: kolkataDisplayDate(`${from}T00:00:00Z`),
    toLabel: kolkataDisplayDate(`${to}T00:00:00Z`),
    previousFrom,
    previousTo,
    granularity,
    days: Math.max(1, Math.round(days)),
  };
}

/**
 * Bucket a Kolkata date string into a week (Monday start) or month label,
 * used for trend charts when the period is aggregated beyond daily.
 */
export function bucketLabel(dateIso: string, granularity: "day" | "week" | "month"): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  if (granularity === "month") {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: REPORTING_TIMEZONE,
      month: "short",
      year: "numeric",
    }).format(d);
  }
  if (granularity === "week") {
    const day = d.getUTCDay(); // 0 = Sun
    const mondayOffset = (day + 6) % 7; // days back to Monday (UTC approx)
    const monday = new Date(d.getTime() - mondayOffset * 86400000);
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: REPORTING_TIMEZONE,
      day: "numeric",
      month: "short",
    }).format(monday);
  }
  return kolkataDisplayDate(`${dateIso}T00:00:00Z`);
}

/**
 * Duration buckets for the reading-time histogram, in seconds. Matches the
 * intervals used consistently across the dashboard:
 * under 10s, 10-30s, 30-60s, 1-3min, 3-5min, 5-10min, over 10min.
 */
export const ENGAGEMENT_BUCKETS: { label: string; min: number; max: number | null }[] = [
  { label: "Under 10s", min: 0, max: 10 },
  { label: "10–30s", min: 10, max: 30 },
  { label: "30–60s", min: 30, max: 60 },
  { label: "1–3 min", min: 60, max: 180 },
  { label: "3–5 min", min: 180, max: 300 },
  { label: "5–10 min", min: 300, max: 600 },
  { label: "Over 10 min", min: 600, max: null },
];

/** Bucket index for an engaged-time value (seconds), or -1 when negative. */
export function bucketIndex(seconds: number): number {
  for (let i = 0; i < ENGAGEMENT_BUCKETS.length; i += 1) {
    const { min, max } = ENGAGEMENT_BUCKETS[i];
    if (seconds >= min && (max === null || seconds < max)) return i;
  }
  return -1;
}

/** Format a duration in seconds for display (e.g. "2m 30s", "45s"). */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  if (minutes === 0) return `${remainder}s`;
  if (remainder === 0) return `${minutes}m`;
  return `${minutes}m ${remainder}s`;
}

/** Format a percentage with one decimal, or "—" when not meaningful. */
export function formatPercent(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

/** Format a large number with grouping separators, or "—" when missing. */
export function formatCount(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-IN");
}

/** Percentage change from previous to current, or null when not computable. */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current > 0 ? null : 0; // no baseline: can't express a %
  return ((current - previous) / previous) * 100;
}
