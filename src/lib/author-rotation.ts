/**
 * t169: rotating author names per automation profile. Pure helpers,
 * unit-tested; the SQL in automation.server.ts mirrors takeTurn().
 *
 * - names: the admin's ordered list (unique, case-insensitive).
 * - cursor: the slot the NEXT published article gets. Always read modulo
 *   the list length, so removing names can never point past the end.
 */
import { checkAuthorName } from "./author-name.ts";

export const MAX_AUTHORS = 25;

export type AuthorListCheck = { ok: true; names: string[] } | { ok: false; error: string };

/** Trim, validate each name, reject empties and case-insensitive duplicates. */
export function checkAuthorList(raw: unknown): AuthorListCheck {
  if (!Array.isArray(raw)) return { ok: false, error: "Authors must be a list of names." };
  if (raw.length > MAX_AUTHORS) return { ok: false, error: `Up to ${MAX_AUTHORS} authors per profile.` };
  const names: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const r = checkAuthorName(raw[i]);
    if (!r.ok) return { ok: false, error: `Author ${i + 1}: ${r.error}` };
    if (!r.value) return { ok: false, error: `Author ${i + 1} is empty. Type a name or remove the row.` };
    const key = r.value.toLowerCase();
    if (seen.has(key)) return { ok: false, error: `“${r.value}” is in the list twice.` };
    seen.add(key);
    names.push(r.value);
  }
  return { ok: true, names };
}

/** The slot a cursor points at, always inside the list. */
export function slotFor(cursor: number, length: number): number {
  if (length <= 0) return 0;
  const c = Number.isFinite(cursor) ? Math.trunc(cursor) : 0;
  return ((c % length) + length) % length;
}

export function nextUpName(names: string[], cursor: number): string | null {
  return names.length ? names[slotFor(cursor, names.length)] : null;
}

/** One publish: the name it gets and the stored cursor afterwards. */
export function takeTurn(names: string[], cursor: number): { name: string | null; cursor: number } {
  if (!names.length) return { name: null, cursor: 0 };
  const slot = slotFor(cursor, names.length);
  return { name: names[slot], cursor: (slot + 1) % names.length };
}

/**
 * Cursor after the admin edits the list: the person who was "next up" stays
 * next up if they are still in the list (wherever they moved). If they were
 * removed, the cursor keeps its position, clamped into the new list.
 */
export function cursorAfterEdit(oldNames: string[], oldCursor: number, newNames: string[]): number {
  if (!newNames.length) return 0;
  const next = nextUpName(oldNames, oldCursor);
  if (next) {
    const i = newNames.findIndex((n) => n.toLowerCase() === next.toLowerCase());
    if (i >= 0) return i;
  }
  return slotFor(oldNames.length ? slotFor(oldCursor, oldNames.length) : 0, newNames.length);
}

/** Move one entry (used by drag-and-drop and the up/down buttons). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list.slice();
  const target = Math.max(0, Math.min(list.length - 1, to));
  const out = list.slice();
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item);
  return out;
}

/**
 * The one atomic statement that hands out a turn (params: $1 updated_at,
 * $2 profile_id). Returns the NEW cursor; the slot taken is cursor - 1.
 */
export const TAKE_TURN_SQL = `update automation_authors
  set next_index = ((next_index % json_array_length(names)) + 1) % json_array_length(names), updated_at = $1
  where profile_id = $2 and json_array_length(names) > 0
  returning names, next_index`;

/** Name for the slot just taken, from the row TAKE_TURN_SQL returned. */
export function nameFromTurnRow(row: { names: string; next_index: number } | undefined): string | null {
  if (!row) return null;
  let names: unknown;
  try { names = JSON.parse(row.names); } catch { return null; }
  if (!Array.isArray(names) || !names.length) return null;
  const slot = slotFor(Number(row.next_index) - 1, names.length);
  return typeof names[slot] === "string" ? names[slot] : null;
}
