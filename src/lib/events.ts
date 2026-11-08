/**
 * Seasonal site events (admin → Events).
 *
 * One small, additive layer: while an event is live the public shell shows a
 * ribbon, a festive rule on the header/footer and a light particle effect.
 * Article, homepage, ticker, ad and appearance features are never changed, and
 * with no live event the layer renders nothing at all.
 *
 * Pure module (no DOM, no database) so the public shell, the admin editor and
 * the tests share exactly the same rules.
 */
import { z } from "zod";

// t209: Valentine's Day removed (owner); Diwali, Holi and Eid added. See normalizeEvents for stored legacy data.
export const EVENT_THEMES = ["christmas", "newyear", "diwali", "holi", "eid", "halloween", "custom"] as const;
export type EventTheme = (typeof EVENT_THEMES)[number];

export const EVENT_EFFECTS = ["snow", "confetti", "sparkle", "none"] as const;
export type EventEffect = (typeof EVENT_EFFECTS)[number];

export const EVENT_INTENSITIES = ["subtle", "festive"] as const;
export type EventIntensity = (typeof EVENT_INTENSITIES)[number];

export type EventColors = { primary: string; secondary: string; ink: string };

export type SiteEvent = {
  id: string;
  name: string;
  theme: EventTheme;
  /** Switched off = never shown, whatever the dates say. */
  enabled: boolean;
  /** ISO timestamps; the event is live for now >= startsAt and now <= endsAt. Empty = open-ended on that side. */
  startsAt: string;
  endsAt: string;
  /** Message bar above the site header. */
  banner: boolean;
  message: string;
  ctaLabel: string;
  ctaHref: string;
  effect: EventEffect;
  intensity: EventIntensity;
  colors: EventColors;
  /** t210: year shown by designs that show one (New Year). Absent/null = automatic. */
  year?: number | null;
  /** t214: server-stamped time of the last meaningful saved change (never sent by the browser). */
  editedAt?: string;
};

export type EventsConfig = { events: SiteEvent[] };

/** More than a handful of overlapping events is never useful, and keeps the layer light. */
export const MAX_EVENTS = 8;

export type EventPreset = {
  value: EventTheme;
  label: string;
  effect: EventEffect;
  colors: EventColors;
  message: string;
};

export const EVENT_PRESETS: EventPreset[] = [
  {
    value: "christmas",
    label: "Christmas",
    effect: "snow",
    colors: { primary: "#0f5132", secondary: "#b3122f", ink: "#fff7e6" },
    message: "Merry Christmas from DYPOL BLOG — thank you for reading with us this year.",
  },
  {
    value: "newyear",
    label: "New Year",
    effect: "sparkle",
    colors: { primary: "#141d45", secondary: "#d4af37", ink: "#fbf7ea" },
    message: "Happy New Year from DYPOL BLOG — thank you for reading with us.",
  },
  {
    value: "halloween",
    label: "Halloween",
    effect: "sparkle",
    colors: { primary: "#2b1140", secondary: "#ff7518", ink: "#fff2e6" },
    message: "Happy Halloween from DYPOL BLOG — read something eerie tonight.",
  },
  {
    value: "diwali",
    label: "Diwali",
    effect: "sparkle",
    colors: { primary: "#3a1550", secondary: "#ffb020", ink: "#fff4e0" },
    message: "Happy Diwali from DYPOL BLOG — wishing you light, joy and good stories.",
  },
  {
    value: "holi",
    label: "Holi",
    effect: "confetti",
    colors: { primary: "#3b1a5a", secondary: "#ff4fa3", ink: "#fff7fb" },
    message: "Happy Holi from DYPOL BLOG — a season of colour and good stories.",
  },
  {
    value: "eid",
    label: "Eid",
    effect: "sparkle",
    colors: { primary: "#0d3b3a", secondary: "#c9a24a", ink: "#f6efd9" },
    message: "Eid Mubarak from DYPOL BLOG — warm wishes to you and your family.",
  },
  {
    value: "custom",
    label: "Custom",
    effect: "none",
    colors: { primary: "#111111", secondary: "#ff4d00", ink: "#ffffff" },
    message: "",
  },
];

export function eventPreset(theme: EventTheme): EventPreset {
  return EVENT_PRESETS.find((preset) => preset.value === theme) ?? (EVENT_PRESETS[EVENT_PRESETS.length - 1] as EventPreset);
}

/** A site path or an https link. Anything else is dropped instead of being rendered. */
export function eventHrefOk(href: string): boolean {
  const value = href.trim();
  if (!value) return true;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  return /^https:\/\/[^\s]+$/i.test(value);
}

// ---- t210: date-only schedules in India time (Asia/Kolkata, UTC+05:30, no DST) ----
export const EVENT_YEAR_MIN = 2000;
export const EVENT_YEAR_MAX = 2100;
export const SCHEDULE_ZONE = "Asia/Kolkata";
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Strict calendar date "YYYY-MM-DD" → [y, m, d], or null (rejects 2027-02-29, 2026-13-01, …). */
export function parseDateOnly(value: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate(); // days in month, computed in UTC (no local-time footgun)
  return d <= dim ? [y, mo, d] : null;
}
/** First moment of a date in India time, as an ISO instant (e.g. 2026-12-31 → 2026-12-30T18:30:00.000Z). */
export function startOfDateIST(value: string): string | null {
  const p = parseDateOnly(value);
  return p ? new Date(Date.UTC(p[0], p[1] - 1, p[2]) - IST_OFFSET_MS).toISOString() : null;
}
/** Last moment of a date in India time (inclusive end): next day 00:00 IST minus 1 ms. */
export function endOfDateIST(value: string): string | null {
  const p = parseDateOnly(value);
  return p ? new Date(Date.UTC(p[0], p[1] - 1, p[2]) - IST_OFFSET_MS + DAY_MS - 1).toISOString() : null;
}
/** The India-time calendar date of an instant ("" for empty/invalid). Used to show legacy timestamps too. */
export function istDateOf(iso: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10) : "";
}
export function isDayStartIST(iso: string): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && (((t + IST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS === 0;
}
export function isDayEndIST(iso: string): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && (((t + IST_OFFSET_MS + 1) % DAY_MS) + DAY_MS) % DAY_MS === 0;
}

const hexColor = z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/, "Use a colour such as #0f5132.");
const isoDate = z.string().trim().refine((value) => value === "" || Number.isFinite(Date.parse(value)), "Use a valid date and time, or leave it empty.");

export const eventSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9][a-z0-9_-]*$/i, "Use letters, numbers, - or _."),
    name: z.string().trim().min(1, "Give the event a name.").max(60),
    theme: z.enum(EVENT_THEMES),
    enabled: z.boolean(),
    startsAt: isoDate,
    endsAt: isoDate,
    banner: z.boolean(),
    message: z.string().trim().max(160),
    ctaLabel: z.string().trim().max(30),
    ctaHref: z.string().trim().max(300),
    effect: z.enum(EVENT_EFFECTS),
    intensity: z.enum(EVENT_INTENSITIES),
    colors: z.object({ primary: hexColor, secondary: hexColor, ink: hexColor }),
    // t210: optional display year; integers only (it is rendered into SVG text), absent = automatic.
    year: z.number().int().min(EVENT_YEAR_MIN).max(EVENT_YEAR_MAX).nullable().optional(),
    // t214: server-controlled; whatever a browser sends is replaced by stampEdits() on save.
    editedAt: z.string().max(40).refine((v) => Number.isFinite(Date.parse(v)), "Bad timestamp").optional(),
  })
  .superRefine((event, ctx) => {
    if (event.startsAt && event.endsAt && Date.parse(event.endsAt) <= Date.parse(event.startsAt)) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The end must be after the start." });
    }
    if (event.ctaHref && !eventHrefOk(event.ctaHref)) {
      ctx.addIssue({ code: "custom", path: ["ctaHref"], message: "Use /path or an https:// link." });
    }
  });

function clean(event: SiteEvent): SiteEvent {
  const href = eventHrefOk(event.ctaHref) ? event.ctaHref.trim() : "";
  return { ...event, ctaHref: href, ctaLabel: href ? event.ctaLabel : "" };
}

export const eventsConfigSchema = z.object({
  events: z
    .array(eventSchema)
    .max(MAX_EVENTS)
    .refine((list) => new Set(list.map((event) => event.id)).size === list.length, "Each event needs a unique id."),
});

/**
 * Strict parse for admin saves: invalid input is reported, never silently stored.
 * t210: schedules are date-only. A start must be 00:00 India time and an end 23:59:59.999 India
 * time (inclusive last day). The one exception is a legacy timestamp the owner did not touch:
 * it is accepted only if it is identical to the value already stored for the same event id,
 * so saving other edits never shifts an existing live schedule.
 */
export function parseEvents(input: unknown, previous: EventsConfig | null = null): EventsConfig {
  const parsed = eventsConfigSchema.parse(input ?? { events: [] });
  const before = new Map((previous?.events ?? []).map((event) => [event.id, event]));
  parsed.events.forEach((event, index) => {
    const old = before.get(event.id);
    const issue = (field: "startsAt" | "endsAt", message: string) => {
      throw new z.ZodError([{ code: "custom", path: ["events", index, field], message, input: event[field] }]);
    };
    if (event.startsAt && !isDayStartIST(event.startsAt) && event.startsAt !== old?.startsAt) issue("startsAt", "Pick a start date (dates only).");
    if (event.endsAt && !isDayEndIST(event.endsAt) && event.endsAt !== old?.endsAt) issue("endsAt", "Pick an end date (dates only).");
  });
  return { events: parsed.events.map(clean) };
}

/**
 * t209: stored events from before Valentine's Day was removed. An event that is unmistakably the
 * Valentine's event (legacy theme AND a Valentine id or name) is dropped; any other event that
 * used the legacy theme keeps all its data and becomes a Custom event, so nothing else is lost.
 */
export function migrateLegacyEvents(input: unknown): unknown {
  const raw = input && typeof input === "object" ? (input as { events?: unknown }).events : null;
  if (!Array.isArray(raw)) return input;
  const events = raw
    .filter((item) => {
      if (!item || typeof item !== "object") return true;
      const event = item as { theme?: unknown; id?: unknown; name?: unknown };
      if (event.theme !== "valentines") return true;
      return !/valentine/i.test(`${String(event.id ?? "")} ${String(event.name ?? "")}`);
    })
    .map((item) => (item && typeof item === "object" && (item as { theme?: unknown }).theme === "valentines" ? { ...(item as object), theme: "custom" } : item));
  return { ...(input as object), events };
}

/** Lenient parse for stored data: keep every valid event, ignore broken ones. */
export function normalizeEvents(stored: unknown): EventsConfig {
  const input = migrateLegacyEvents(stored);
  const strict = eventsConfigSchema.safeParse(input);
  if (strict.success) return { events: strict.data.events.map(clean) };
  const raw = input && typeof input === "object" ? (input as { events?: unknown }).events : null;
  if (!Array.isArray(raw)) return { events: [] };
  const events: SiteEvent[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (events.length >= MAX_EVENTS) break;
    const parsed = eventSchema.safeParse(item);
    if (!parsed.success) continue;
    if (ids.has(parsed.data.id)) continue;
    ids.add(parsed.data.id);
    events.push(clean(parsed.data));
  }
  return { events };
}

export type EventStatus = "off" | "upcoming" | "live" | "ended";

/** off = switched off, upcoming = starts later, live = showing now, ended = finished. */
export function eventStatus(event: Pick<SiteEvent, "enabled" | "startsAt" | "endsAt">, now = Date.now()): EventStatus {
  if (!event.enabled) return "off";
  // t202: an empty start or end means open-ended on that side.
  const start = event.startsAt ? Date.parse(event.startsAt) : -Infinity;
  const end = event.endsAt ? Date.parse(event.endsAt) : Infinity;
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return "off";
  if (now < start) return "upcoming";
  if (now > end) return "ended";
  return "live";
}

/**
 * The event the public site shows right now.
 * `overrideId` is the admin preview (`/?event=<id>`): it wins even for a
 * switched-off event so the owner can look before turning it on.
 * If two events are live, the one that started most recently wins.
 */
export function resolveActiveEvent(config: EventsConfig, now = Date.now(), overrideId?: string | null, allowOverride = false): SiteEvent | null {
  // t202: the preview override is for a signed-in admin only (the caller checks the desk session).
  if (overrideId && allowOverride) {
    const preview = config.events.find((event) => event.id === overrideId);
    if (preview) return preview;
  }
  const live = config.events.filter((event) => eventStatus(event, now) === "live");
  if (live.length === 0) return null;
  const startOf = (event: SiteEvent) => (event.startsAt ? Date.parse(event.startsAt) : -Infinity);
  return live.reduce((best, event) => (startOf(event) > startOf(best) ? event : best));
}

/** December 1 → January 6. t202: ships switched OFF; the owner turns it on in Admin → Events. */
export function christmasEvent(year = new Date().getFullYear()): SiteEvent {
  const preset = eventPreset("christmas");
  return {
    id: "christmas",
    name: "Christmas",
    theme: "christmas",
    enabled: false,
    // t210: whole days in India time — 1 Dec to 6 Jan inclusive.
    startsAt: startOfDateIST(`${year}-12-01`) as string,
    endsAt: endOfDateIST(`${year + 1}-01-06`) as string,
    banner: true,
    message: preset.message,
    ctaLabel: "",
    ctaHref: "",
    effect: "snow",
    intensity: "subtle",
    colors: { ...preset.colors },
  };
}

/**
 * t208: New Year's Eve → January 2. Ships switched OFF; the owner turns it on in Admin → Events.
 * `year` is the year that is ending (31 Dec of `year` → 2 Jan of `year + 1`).
 */
export function newYearEvent(year = new Date().getUTCFullYear()): SiteEvent {
  const preset = eventPreset("newyear");
  return {
    id: "newyear",
    name: "New Year",
    theme: "newyear",
    enabled: false,
    // t210: whole days in India time — 31 Dec to 2 Jan inclusive.
    startsAt: startOfDateIST(`${year}-12-31`) as string,
    endsAt: endOfDateIST(`${year + 1}-01-02`) as string,
    banner: true,
    message: preset.message,
    ctaLabel: "",
    ctaHref: "",
    effect: "sparkle",
    intensity: "subtle",
    colors: { ...preset.colors },
  };
}

/**
 * t208: the year a New Year event celebrates. The moment used is "now", held inside the
 * event's own window (so an admin preview of a future or past event shows that event's year).
 * Late in the year (October onwards) means the coming year; otherwise the current one.
 * Month-based in UTC, so midnight time-zone differences can never flip it.
 */
export function celebratedYear(event: (Pick<SiteEvent, "startsAt" | "endsAt"> & { year?: number | null }) | null, now = Date.now()): number {
  // t210: an explicit year set by the owner always wins (never replaced by the schedule or today's date).
  if (event && Number.isInteger(event.year) && (event.year as number) >= EVENT_YEAR_MIN && (event.year as number) <= EVENT_YEAR_MAX) return event.year as number;
  let at = now;
  const start = event?.startsAt ? Date.parse(event.startsAt) : NaN;
  const end = event?.endsAt ? Date.parse(event.endsAt) : NaN;
  if (Number.isFinite(start) && at < start) at = start;
  if (Number.isFinite(end) && at > end) at = end;
  const date = new Date(at);
  return date.getUTCMonth() >= 9 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
}

/**
 * The starting configuration of the Events tab: the Christmas event, aimed at
 * the Christmas season that is coming up (in January it still points at the
 * season that is finishing, not at next December).
 */
export function defaultEvents(now = new Date()): EventsConfig {
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  // t211: one example event only (switched off). Other designs — New Year, Diwali, Holi, Eid — are picked
  // from the Design dropdown of any event; there are no separate seeded cards or per-theme add buttons.
  return { events: [christmasEvent(year)] };
}

/**
 * t209: Diwali / Holi / Eid presets. Their dates move every year (lunar/lunisolar calendars), so
 * they ship switched OFF with NO dates: the owner picks the real dates before turning one on.
 * The admin editor warns that an enabled event with no dates shows indefinitely.
 */
export const FESTIVAL_PRESET_THEMES = ["diwali", "holi", "eid"] as const;
export function festivalEvent(theme: (typeof FESTIVAL_PRESET_THEMES)[number]): SiteEvent {
  const preset = eventPreset(theme);
  return {
    id: theme,
    name: preset.label,
    theme,
    enabled: false,
    startsAt: "",
    endsAt: "",
    banner: true,
    message: preset.message,
    ctaLabel: "",
    ctaHref: "",
    effect: preset.effect,
    intensity: "subtle",
    colors: { ...preset.colors },
  };
}

/** A fresh two-week event for the "Add event" button. */
export function newEventDraft(theme: EventTheme = "christmas", now = new Date()): SiteEvent {
  const preset = eventPreset(theme);
  return {
    id: `event-${now.getTime().toString(36)}`,
    name: preset.label,
    theme,
    enabled: false,
    // t210: today → 13 days later, whole days in India time.
    startsAt: startOfDateIST(istDateOf(now.toISOString())) as string,
    endsAt: endOfDateIST(istDateOf(new Date(now.getTime() + 13 * DAY_MS).toISOString())) as string,
    banner: true,
    message: preset.message,
    ctaLabel: "",
    ctaHref: "",
    effect: preset.effect,
    intensity: "subtle",
    colors: { ...preset.colors },
  };
}

// ---------------------------------------------------------------------------------------------
// t213/t214: lifecycle of saved events — Upcoming → Ongoing → Expired (kept 7 days) → deleted.
// ---------------------------------------------------------------------------------------------
export const EXPIRED_RETENTION_DAYS = 7;
export const EXPIRED_RETENTION_MS = EXPIRED_RETENTION_DAYS * DAY_MS;

export type EventLifecycle = "upcoming" | "ongoing" | "waiting" | "paused" | "expired";

/** Exclusive end instant (the first moment after the inclusive end date), or null if open-ended. */
function endExclusive(event: Pick<SiteEvent, "endsAt">): number | null {
  if (!event.endsAt) return null;
  const t = Date.parse(event.endsAt);
  return Number.isFinite(t) ? t + 1 : null;
}

/**
 * When an expired event is deleted: 7 days after its inclusive end (IST end of day), or 7 days
 * after a later meaningful saved edit — whichever is later. Open-ended/undated events: never.
 * Legacy rows without editedAt use the end date only; reading never changes this.
 */
export function purgeDeadline(event: Pick<SiteEvent, "endsAt" | "editedAt">): number | null {
  const end = endExclusive(event);
  if (end === null) return null;
  const edited = event.editedAt ? Date.parse(event.editedAt) : NaN;
  return Math.max(end, Number.isFinite(edited) ? edited : -Infinity) + EXPIRED_RETENTION_MS;
}

/** Honest card status. "waiting" = inside its dates but another live event is the one applied. */
export function eventLifecycle(event: SiteEvent, config: EventsConfig, now = Date.now()): EventLifecycle {
  const end = endExclusive(event);
  if (end !== null && now >= end) return "expired";
  if (!event.enabled) return "paused";
  if (event.startsAt && now < Date.parse(event.startsAt)) return "upcoming";
  return resolveActiveEvent(config, now)?.id === event.id ? "ongoing" : "waiting";
}

/** Drop events whose deletion deadline has passed (now >= deadline). Pure; never touches undated rows. */
export function purgeExpired(config: EventsConfig, now = Date.now()): { config: EventsConfig; removed: SiteEvent[] } {
  const removed: SiteEvent[] = [];
  const events = config.events.filter((event) => {
    const deadline = purgeDeadline(event);
    if (deadline !== null && now >= deadline) {
      removed.push(event);
      return false;
    }
    return true;
  });
  return { config: { events }, removed };
}

function canonical(event: SiteEvent): string {
  const { editedAt: _e, ...rest } = event;
  const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== null));
  const sort = (v: unknown): unknown =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(sort(clean));
}

/**
 * Server-side edit stamping: an event identical to what is stored (ignoring editedAt) keeps its
 * stored editedAt (or none, for legacy rows); a new or changed event gets editedAt = now.
 * The browser's editedAt is always ignored.
 */
export function stampEdits(next: EventsConfig, previous: EventsConfig | null, now = Date.now()): EventsConfig {
  const before = new Map((previous?.events ?? []).map((event) => [event.id, event]));
  return {
    events: next.events.map((event) => {
      const { editedAt: _client, ...rest } = event;
      const old = before.get(event.id);
      if (old && canonical(old) === canonical(event)) return old.editedAt ? { ...rest, editedAt: old.editedAt } : rest;
      return { ...rest, editedAt: new Date(now).toISOString() };
    }),
  };
}

/** Tiny stable signature of the stored row text, for compare-and-swap between tabs/clean-up. */
export function eventsSignature(raw: string | null): string {
  if (raw === null) return "none";
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) h = Math.imul(h ^ raw.charCodeAt(i), 0x01000193) >>> 0;
  return `${raw.length.toString(36)}-${h.toString(36)}`;
}
