/**
 * t183: Settings → Custom head code as a list of entries (one card per top-level tag).
 *
 * Storage is unchanged: `site.customHead` keeps the kept tags verbatim joined by "\n"
 * (exactly what checkHeadCode already stores), so the rendered <head> is byte-identical
 * until the owner edits, deletes or reorders an entry. Entry names are admin-only and live
 * in their own settings row (keyed by a hash of the entry's code), never in the public site.
 */
import { checkHeadCode } from "./head-html.ts";

export const HEAD_NAMES_ID = "head_code_names";
export const HEAD_NAME_MAX = 80;

export type HeadEntry = { code: string; tag: string; summary: string };
export type HeadNames = Record<string, string>;

/** The stored head code split into entries, each entry's code verbatim. */
export function headEntries(stored: string): HeadEntry[] {
  return checkHeadCode(stored).tags.map(({ code, tag, summary }) => ({ code, tag, summary }));
}

/** Join entries the same way the server stores head code. */
export const joinHeadEntries = (codes: string[]): string => codes.join("\n");

/** Stable, sync 32-bit FNV-1a hash of an entry's code (name lookup key). */
export function headEntryKey(code: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `h${(h >>> 0).toString(16).padStart(8, "0")}${code.length.toString(36)}`;
}

/** A sensible default name for an entry that has none yet. */
export function defaultHeadName(entry: Pick<HeadEntry, "code" | "tag">, index: number): string {
  const c = entry.code.toLowerCase();
  if (entry.tag === "meta" && c.includes("google-site-verification")) return "Google Search Console verification";
  if (entry.tag === "meta" && c.includes("msvalidate.01")) return "Bing Webmaster verification";
  if (entry.tag === "meta" && c.includes("p:domain_verify")) return "Pinterest verification";
  if (entry.tag === "meta" && c.includes("yandex-verification")) return "Yandex verification";
  if (c.includes("clarity.ms") || c.includes('"clarity"')) return "Microsoft Clarity";
  if (c.includes("posthog")) return "PostHog";
  if (c.includes("googletagmanager.com/gtm") || c.includes("gtm.start")) return "Google Tag Manager";
  if (c.includes("googletagmanager.com/gtag") || c.includes("gtag(")) return "Google tag (gtag.js)";
  if (c.includes("plausible.io")) return "Plausible";
  if (c.includes("hotjar")) return "Hotjar";
  return `Custom ${entry.tag} ${index + 1}`;
}

export function headNameFor(names: HeadNames, entry: Pick<HeadEntry, "code" | "tag">, index: number): string {
  return names[headEntryKey(entry.code)]?.trim() || defaultHeadName(entry, index);
}

export type HeadChange = { code: string; names: HeadNames } | { error: string };

const cleanName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, HEAD_NAME_MAX);

/** Names for the given entries: explicit names kept, others filled with the default, pruned to present entries. */
function namesFor(codes: string[], names: HeadNames): HeadNames {
  const out: HeadNames = {};
  codes.forEach((code, i) => {
    const key = headEntryKey(code);
    out[key] = out[key] ?? (names[key]?.trim() || defaultHeadName({ code, tag: headEntries(code)[0]?.tag ?? "tag" }, i));
  });
  return out;
}

function snippetCodes(snippet: string): string[] | { error: string } {
  const check = checkHeadCode(snippet);
  if (!check.tags.length) return { error: "No head tag found. Paste a <meta>, <link>, <script>, <style> or <noscript> tag." };
  return check.tags.map((t) => t.code);
}

function named(codes: string[], name: string, names: HeadNames): HeadNames {
  const n = cleanName(name);
  const next = { ...names };
  if (n) codes.forEach((code, i) => { next[headEntryKey(code)] = i === 0 ? n : `${n} (${i + 1})`; });
  return next;
}

/** Append a new snippet (one entry per tag it contains) after the existing entries. */
export function addHeadEntry(stored: string, names: HeadNames, snippet: string, name = ""): HeadChange {
  const add = snippetCodes(snippet);
  if (!Array.isArray(add)) return add;
  const codes = [...headEntries(stored).map((e) => e.code), ...add];
  return { code: joinHeadEntries(codes), names: namesFor(codes, named(add, name, names)) };
}

/** Replace entry `index` with an edited snippet (may become several entries). */
export function replaceHeadEntry(stored: string, names: HeadNames, index: number, snippet: string, name = ""): HeadChange {
  const list = headEntries(stored).map((e) => e.code);
  if (index < 0 || index >= list.length) return { error: "That head code entry no longer exists. Reload the page." };
  const repl = snippetCodes(snippet);
  if (!Array.isArray(repl)) return { error: `${repl.error} To remove this entry, use Delete.` };
  const old = list[index]!;
  const keep = cleanName(name) || names[headEntryKey(old)] || defaultHeadName({ code: old, tag: headEntries(old)[0]?.tag ?? "tag" }, index);
  list.splice(index, 1, ...repl);
  return { code: joinHeadEntries(list), names: namesFor(list, named(repl, keep, names)) };
}

export function removeHeadEntry(stored: string, names: HeadNames, index: number): HeadChange {
  const list = headEntries(stored).map((e) => e.code);
  if (index < 0 || index >= list.length) return { error: "That head code entry no longer exists. Reload the page." };
  // Keep the names of the remaining entries as they are shown now (defaults follow position).
  const shown = namesFor(list, names);
  list.splice(index, 1);
  return { code: joinHeadEntries(list), names: namesFor(list, shown) };
}

export function moveHeadEntry(stored: string, names: HeadNames, index: number, direction: -1 | 1): HeadChange {
  const list = headEntries(stored).map((e) => e.code);
  const target = index + direction;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return { error: "That entry cannot move further." };
  const shown = namesFor(list, names);
  [list[index], list[target]] = [list[target]!, list[index]!];
  return { code: joinHeadEntries(list), names: namesFor(list, shown) };
}

/** Sanitize a names map from the client: string values only, short, only for present entries. */
export function cleanHeadNames(raw: unknown, stored: string): HeadNames {
  const present = new Set(headEntries(stored).map((e) => headEntryKey(e.code)));
  const out: HeadNames = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (present.has(k) && typeof v === "string" && cleanName(v)) out[k] = cleanName(v);
    }
  }
  return out;
}
