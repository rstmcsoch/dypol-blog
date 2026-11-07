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

export const EVENT_THEMES = ["christmas", "newyear", "halloween", "valentines", "custom"] as const;
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
  /** ISO timestamps; the event is live for now >= startsAt and now <= endsAt. */
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
    value: "valentines",
    label: "Valentine's Day",
    effect: "confetti",
    colors: { primary: "#8c1d3f", secondary: "#f2a2b4", ink: "#fff5f8" },
    message: "Happy Valentine's Day from DYPOL BLOG.",
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
const isoDate = z.string().trim().refine((value) => Number.isFinite(Date.parse(value)), "Use a valid date and time.");

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
    if (Date.parse(event.endsAt) <= Date.parse(event.startsAt)) {
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

/** Lenient parse for stored data: keep every valid event, ignore broken ones. */
export function normalizeEvents(input: unknown): EventsConfig {
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
  const start = Date.parse(event.startsAt);
  const end = Date.parse(event.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "off";
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
export function resolveActiveEvent(config: EventsConfig, now = Date.now(), overrideId?: string | null): SiteEvent | null {
  if (overrideId) {
    const preview = config.events.find((event) => event.id === overrideId);
    if (preview) return preview;
  }
  const live = config.events.filter((event) => eventStatus(event, now) === "live");
  if (live.length === 0) return null;
  return live.reduce((best, event) => (Date.parse(event.startsAt) > Date.parse(best.startsAt) ? event : best));
}

/** December 1 → January 6, ready to switch itself on for the season. */
export function christmasEvent(year = new Date().getFullYear()): SiteEvent {
  const preset = eventPreset("christmas");
  return {
    id: "christmas",
    name: "Christmas",
    theme: "christmas",
    enabled: true,
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
 * The starting configuration of the Events tab: the Christmas event, aimed at
 * the Christmas season that is coming up (in January it still points at the
 * season that is finishing, not at next December).
 */
export function defaultEvents(now = new Date()): EventsConfig {
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  return { events: [christmasEvent(year)] };
}

/** A fresh two-week event for the "Add event" button. */
export function newEventDraft(theme: EventTheme = "christmas", now = new Date()): SiteEvent {
  const preset = eventPreset(theme);
  return {
    id: `event-${now.getTime().toString(36)}`,
    name: preset.label,
    theme,
    enabled: true,
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
