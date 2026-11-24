/**
 * Seasonal site events: one settings row (`site_settings` id 'site_events'),
 * cached like the rest of the public content and invalidated by the usual
 * content_version bump on write.
 */
import { getSql } from "@/lib/db";
import { cachedRead } from "@/lib/content-cache.server";
import {
  defaultEvents,
  normalizeEvents,
  eventsSignature,
  parseEvents,
  purgeExpired,
  resolveActiveEvent,
  stampEdits,
  sweepStore,
  type EventsConfig,
  type SiteEvent,
} from "@/lib/events";

export const EVENTS_SETTINGS_ID = "site_events";

async function loadEvents(): Promise<EventsConfig> {
  const sql = await getSql();
  return cachedRead("site-events", sql, async () => {
    const rows = await sql<{ data: string }>`select data from site_settings where id = ${EVENTS_SETTINGS_ID}`;
    if (!rows[0]) return defaultEvents();
    try {
      return normalizeEvents(JSON.parse(rows[0].data));
    } catch {
      return defaultEvents();
    }
  });
}

/** Uncached read of the stored row text (for compare-and-swap writes). */
async function readRaw(sql: Awaited<ReturnType<typeof getSql>>): Promise<string | null> {
  const rows = await sql<{ data: string }>`select data from site_settings where id = ${EVENTS_SETTINGS_ID}`;
  return rows[0]?.data ?? null;
}
function parseRaw(raw: string | null): EventsConfig | null {
  if (raw === null) return null;
  try {
    return normalizeEvents(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * t214: automatic clean-up. Expired events stay (tagged Expired) for 7 days after their inclusive
 * end date or their last meaningful saved edit, then are deleted from storage. Runs server-side on
 * the normal request path (public pages and the admin tab) — no browser or cron needed — and only
 * writes when something is actually past its deadline. Compare-and-swap on the exact stored text,
 * so a concurrent admin save is never overwritten; undated / open-ended events are never touched.
 */
export async function sweepExpiredEvents(now = Date.now(), cached?: EventsConfig): Promise<number> {
  if (cached && purgeExpired(cached, now).removed.length === 0) return 0;
  const sql = await getSql();
  const out = await sweepStore(
    {
      read: () => readRaw(sql),
      swap: async (expected, next) =>
        (await sql<{ id: string }>`update site_settings set data = ${next}
          where id = ${EVENTS_SETTINGS_ID} and data = ${expected} returning id`).length > 0,
    },
    now,
  );
  return out.removed.length;
}

async function loadSwept(now = Date.now()): Promise<EventsConfig> {
  const config = await loadEvents();
  try {
    if (await sweepExpiredEvents(now, config)) return await loadEvents();
  } catch {
    /* best effort; the next request retries */
  }
  return config;
}

/** Admin tab: events + a signature of the stored row for compare-and-swap saves. */
export async function readEventsForAdmin(now = Date.now()): Promise<{ config: EventsConfig; version: string }> {
  try {
    await loadSwept(now);
    const sql = await getSql();
    const raw = await readRaw(sql);
    return { config: parseRaw(raw) ?? defaultEvents(), version: eventsSignature(raw) };
  } catch {
    return { config: defaultEvents(), version: "none" };
  }
}

/** All events for the admin tab; the Christmas default when nothing is saved yet. */
export async function readEvents(): Promise<EventsConfig> {
  try {
    return await loadEvents();
  } catch {
    return defaultEvents();
  }
}

/**
 * The event the public shell shows right now, or null (the ordinary site).
 * `overrideId` is the admin preview from `/?event=<id>`.
 */
export async function readActiveEvent(now = Date.now(), overrideId: string | null = null, allowOverride = false): Promise<SiteEvent | null> {
  try {
    return resolveActiveEvent(await loadSwept(now), now, overrideId, allowOverride);
  } catch {
    return null;
  }
}

export class EventsConflictError extends Error {
  constructor() {
    super("Events were changed elsewhere (another tab or the automatic clean-up). Reload the page and try again.");
  }
}

/**
 * Admin save with compare-and-swap: `version` must match the stored row the editor loaded.
 * t210 legacy-timestamp rule and t214 server edit stamps are applied against that same row.
 */
export async function saveEvents(raw: unknown, version: string, now = Date.now()): Promise<{ config: EventsConfig; version: string }> {
  const sql = await getSql();
  const storedRaw = await readRaw(sql);
  if (eventsSignature(storedRaw) !== version) throw new EventsConflictError();
  const previous = parseRaw(storedRaw);
  const config = purgeExpired(stampEdits(parseEvents(raw, previous), previous, now), now).config;
  const text = JSON.stringify(config);
  const done =
    storedRaw === null
      ? await sql<{ id: string }>`insert into site_settings (id, data) values (${EVENTS_SETTINGS_ID}, ${text}) on conflict (id) do nothing returning id`
      : await sql<{ id: string }>`update site_settings set data = ${text} where id = ${EVENTS_SETTINGS_ID} and data = ${storedRaw} returning id`;
  if (!done.length) throw new EventsConflictError();
  return { config, version: eventsSignature(text) };
}
