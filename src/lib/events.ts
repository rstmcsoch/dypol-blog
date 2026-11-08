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

/** Strict parse for admin saves: invalid input is reported, never silently stored. */
export function parseEvents(input: unknown): EventsConfig {
  const parsed = eventsConfigSchema.parse(input ?? { events: [] });
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
    startsAt: `${year}-12-01T00:00:00.000Z`,
    endsAt: `${year + 1}-01-06T23:59:00.000Z`,
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
    startsAt: `${year}-12-31T00:00:00.000Z`,
    endsAt: `${year + 1}-01-02T23:59:00.000Z`,
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
export function celebratedYear(event: Pick<SiteEvent, "startsAt" | "endsAt"> | null, now = Date.now()): number {
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
  // t208: the New Year preset ships alongside, also switched off (stored settings are never rewritten).
  return { events: [christmasEvent(year), newYearEvent(year)] };
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
    startsAt: now.toISOString(),
    endsAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    banner: true,
    message: preset.message,
    ctaLabel: "",
    ctaHref: "",
    effect: preset.effect,
    intensity: "subtle",
    colors: { ...preset.colors },
  };
}
