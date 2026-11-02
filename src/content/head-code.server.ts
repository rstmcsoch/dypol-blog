/** t183: Settings → Custom head code entries (saved immediately, one change at a time). */
import { getSql } from "@/lib/db";
import { checkHeadCode } from "@/lib/ads/head-html";
import { cleanHeadNames, HEAD_NAMES_ID, sameHeadNames, type HeadNames } from "@/lib/ads/head-entries";

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

export type HeadSaveResult = { customHead: string; names: HeadNames; codeChanged: boolean; namesChanged: boolean };

/** Write the admin-only names row (literal id: exempt from content_version, see content-cache). */
async function writeNames(names: HeadNames): Promise<void> {
  const sql = await getSql();
  await sql`insert into site_settings (id, data) values ('head_code_names', ${JSON.stringify({ names })})
    on conflict (id) do update set data = excluded.data`;
}

const conflict = () => new HeadCodeConflict("The head code was changed in another tab or by someone else. Reload the page and try again.");

/**
 * Save the whole head code (as produced by the entry helpers) plus admin-only names.
 * `expected` is the head code the admin's change was based on: if someone else saved in
 * between, nothing is written. t189: customHead is only re-extracted and written when the
 * submitted code differs byte-for-byte from what is stored; otherwise only the names row
 * may be written (and only if a name actually changed), so content_version is not bumped.
 */
export async function saveHeadCode(input: { code: string; expected: string; names: unknown }): Promise<HeadSaveResult> {
  const { readSettings, saveSettings } = await import("./repository.server");
  const { site } = await readSettings();
  const current = site.customHead ?? "";
  if (current !== input.expected) throw conflict();
  let stored = current;
  let codeChanged = false;
  if (input.code !== current) {
    const next = checkHeadCode(input.code).code;
    if (next !== current) {
      await saveSettings({ ...site, customHead: next });
      stored = next;
      codeChanged = true;
    }
  }
  const names = cleanHeadNames(input.names, stored);
  const namesChanged = !sameHeadNames(names, await readHeadNames());
  if (namesChanged) await writeNames(names);
  return { customHead: stored, names, codeChanged, namesChanged };
}

/** t189: rename only. Never reads, re-extracts or writes customHead. */
export async function saveHeadNames(input: { expected: string; names: unknown }): Promise<HeadSaveResult> {
  const { readSettings } = await import("./repository.server");
  const { site } = await readSettings();
  const current = site.customHead ?? "";
  if (current !== input.expected) throw conflict();
  const names = cleanHeadNames(input.names, current);
  const namesChanged = !sameHeadNames(names, await readHeadNames());
  if (namesChanged) await writeNames(names);
  return { customHead: current, names, codeChanged: false, namesChanged };
}
