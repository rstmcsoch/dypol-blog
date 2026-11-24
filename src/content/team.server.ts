import { getSql } from "@/lib/db";
import { DEFAULT_TEAM_SETTINGS, normalizeTeamSettings, teamSettingsSchema, type TeamSettings } from "@/lib/team";

const TEAM_SETTINGS_ID = "editorial_team";

export async function readTeamSettings(): Promise<TeamSettings> {
  try {
    const sql = await getSql();
    const rows = await sql<{ data: string }>`select data from site_settings where id = ${TEAM_SETTINGS_ID}`;
    const raw = rows[0]?.data;
    if (!raw) return structuredClone(DEFAULT_TEAM_SETTINGS);
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return normalizeTeamSettings(parsed);
  } catch {
    return structuredClone(DEFAULT_TEAM_SETTINGS);
  }
}

export async function saveTeamSettings(settings: unknown): Promise<TeamSettings> {
  const next = teamSettingsSchema.parse(normalizeTeamSettings(settings));
  const sql = await getSql();
  const data = JSON.stringify(next);
  await sql`insert into site_settings (id, data) values (${TEAM_SETTINGS_ID}, ${data})
    on conflict (id) do update set data = excluded.data`;
  return next;
}
