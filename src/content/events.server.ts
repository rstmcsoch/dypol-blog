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
  parseEvents,
  resolveActiveEvent,
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
    return resolveActiveEvent(await loadEvents(), now, overrideId, allowOverride);
  } catch {
    return null;
  }
}

export async function saveEvents(raw: unknown): Promise<EventsConfig> {
  const config = parseEvents(raw);
  const sql = await getSql();
  await sql`insert into site_settings (id, data) values (${EVENTS_SETTINGS_ID}, ${JSON.stringify(config)})
    on conflict (id) do update set data = excluded.data`;
  return config;
}
