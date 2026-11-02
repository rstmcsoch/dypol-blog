/** t173: read/write the special-automation settings row (site_settings id 'special_automation'). */
import { getSql } from "@/lib/db";
import { DEFAULT_SPECIAL_SETTINGS, normalizeSpecialSettings, SPECIAL_SETTINGS_ID, specialSettingsSchema, type SpecialSettings } from "@/lib/special/settings";

export async function readSpecialSettings(): Promise<SpecialSettings> {
  try {
    const sql = await getSql();
    const rows = await sql<{ data: string }>`select data from site_settings where id = ${SPECIAL_SETTINGS_ID}`;
    if (!rows[0]) return structuredClone(DEFAULT_SPECIAL_SETTINGS);
    return normalizeSpecialSettings(JSON.parse(rows[0].data));
  } catch {
    return structuredClone(DEFAULT_SPECIAL_SETTINGS);
  }
}

export async function saveSpecialSettings(raw: unknown): Promise<SpecialSettings> {
  const settings = specialSettingsSchema.parse(raw);
  const sql = await getSql();
  const cats = await sql<{ id: string }>`select id from categories`;
  const known = new Set(cats.map((c) => c.id));
  // Never store a category id that does not exist (the gate would silently widen later).
  settings.eligibleCategoryIds = settings.eligibleCategoryIds.filter((id) => known.has(id));
  settings.rssFeeds = [...new Set(settings.rssFeeds)];
  await sql`insert into site_settings (id, data) values (${SPECIAL_SETTINGS_ID}, ${JSON.stringify(settings)})
    on conflict (id) do update set data = excluded.data`;
  return settings;
}
