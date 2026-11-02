/** t173: read/write the special-automation settings row (site_settings id 'special_automation'). */
import { getSql } from "@/lib/db";
import { DEFAULT_SPECIAL_SETTINGS, normalizeSpecialSettings, pruneAssignments, SPECIAL_SETTINGS_ID, specialSettingsSchema, withAssignment, type ProfileAssignment, type SpecialSettings } from "@/lib/special/settings";

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
  // t178: only real profiles can be assigned to Special.
  const { listProfiles } = await import("./automation.server");
  const profiles = await listProfiles().catch(() => null);
  if (profiles) settings.profileIds = pruneAssignments(settings.profileIds, profiles.map((p) => p.id));
  await sql`insert into site_settings (id, data) values (${SPECIAL_SETTINGS_ID}, ${JSON.stringify(settings)})
    on conflict (id) do update set data = excluded.data`;
  return settings;
}

/**
 * t178: assign one profile to Normal or Special (the single source of truth used by the
 * Special tab pills, the create-profile form and the profile editor).
 */
export async function setProfileAssignment(profileId: string, section: ProfileAssignment): Promise<SpecialSettings> {
  const current = await readSpecialSettings();
  if (section === "normal" && !current.profileIds.includes(profileId)) return current;
  if (section === "special" && current.profileIds.includes(profileId)) return current;
  return saveSpecialSettings({ ...current, profileIds: withAssignment(current.profileIds, profileId, section) });
}
