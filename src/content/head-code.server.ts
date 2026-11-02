/** t183: Settings → Custom head code entries (saved immediately, one change at a time). */
import { getSql } from "@/lib/db";
import { checkHeadCode } from "@/lib/ads/head-html";
import { cleanHeadNames, HEAD_NAMES_ID, type HeadNames } from "@/lib/ads/head-entries";

export async function readHeadNames(): Promise<HeadNames> {
  try {
    const sql = await getSql();
    const rows = await sql<{ data: string }>`select data from site_settings where id = ${HEAD_NAMES_ID}`;
    const parsed = rows[0] ? JSON.parse(rows[0].data) : {};
    return parsed && typeof parsed === "object" && parsed.names && typeof parsed.names === "object" ? (parsed.names as HeadNames) : {};
  } catch {
    return {};
  }
}

export class HeadCodeConflict extends Error {}

/**
 * Save the whole head code (as produced by the entry helpers) plus admin-only names.
 * `expected` is the head code the admin's change was based on: if someone else saved in
 * between, nothing is written. The site row is saved through saveSettings, the same path
 * as the Settings form, so the public <head> updates at once (content_version).
 */
export async function saveHeadCode(input: { code: string; expected: string; names: unknown }): Promise<{ customHead: string; names: HeadNames }> {
  const { readSettings, saveSettings } = await import("./repository.server");
  const { site } = await readSettings();
  if ((site.customHead ?? "") !== input.expected) throw new HeadCodeConflict("The head code was changed in another tab or by someone else. Reload the page and try again.");
  const stored = checkHeadCode(input.code).code;
  if (stored !== (site.customHead ?? "")) await saveSettings({ ...site, customHead: stored });
  const names = cleanHeadNames(input.names, stored);
  const sql = await getSql();
  await sql`insert into site_settings (id, data) values (${HEAD_NAMES_ID}, ${JSON.stringify({ names })})
    on conflict (id) do update set data = excluded.data`;
  return { customHead: stored, names };
}
