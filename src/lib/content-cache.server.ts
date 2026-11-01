/**
 * t147: in-isolate cache for the public read model (catalog, pages, view counts).
 *
 * Every public page used to re-read the whole catalog from D1 (27 queries for the
 * home page, several of them twice). Now a warm isolate keeps the last result and
 * only checks one tiny row, `content_version.v`, which every content write bumps
 * (see db.ts and the media store). So a publish/update from any isolate shows up on
 * the next request, while unchanged content costs a single cheap query.
 *
 * Safety nets:
 * - entries never outlive CACHE_MAX_MS (covers writes made outside the app, e.g. SQL
 *   run by hand), or 30 s when the version row is unavailable (pre-0024 database);
 * - an entry can carry its own expiry (next scheduled publish time);
 * - writes in this isolate drop everything at once (localGeneration).
 *
 * Plain values only, never shared promises: workerd hangs a request that awaits a
 * promise created by another request.
 */
import type { Sql } from "./db";

const CONTENT_TABLES = "articles|article_tags|article_topics|categories|tags|site_settings|pages|media|redirects|ads_settings";
const CONTENT_WRITE = new RegExp(
  `^\\s*(?:insert|update|delete|replace)\\b(?:\\s+or\\s+\\w+)?(?:\\s+into|\\s+from)?\\s+["\`]?(?:${CONTENT_TABLES})["\`]?(?=[\\s(]|$)`,
  "i",
);

export const BUMP_CONTENT_VERSION_SQL =
  "insert into content_version (id, v) values (1, 1) on conflict (id) do update set v = v + 1";

export const CACHE_MAX_MS = 5 * 60_000;
export const UNVERIFIED_MS = 30_000;
const TOKEN_MEMO_MS = 1_000;

/** True for statements that change what readers see (not analytics or view counters). */
export function isContentWrite(text: string): boolean {
  return CONTENT_WRITE.test(text);
}

let localGeneration = 0;
let tokenMemo: { at: number; v: string | null } | null = null;

type Entry = { value: unknown; gen: number; token: string | null; expiresAt: number };
const entries = new Map<string, Entry>();

/** Drop this isolate's cache and bump the shared version row (best-effort). */
export async function noteContentWrite(bump?: () => Promise<unknown>): Promise<void> {
  localGeneration += 1;
  entries.clear();
  tokenMemo = null;
  if (!bump) return;
  try {
    await bump();
  } catch {
    /* pre-0024 database: the 30 s unverified TTL applies instead */
  }
}

async function remoteToken(sql: Sql): Promise<string | null> {
  const now = Date.now();
  if (tokenMemo && now - tokenMemo.at < TOKEN_MEMO_MS) return tokenMemo.v;
  let v: string | null;
  try {
    const rows = await sql.query<{ v: number }>("select v from content_version where id = 1");
    v = String(rows[0]?.v ?? 0);
  } catch {
    v = null;
  }
  tokenMemo = { at: Date.now(), v };
  return v;
}

export type CachedReadOptions<T> = {
  /** Check content_version before reusing (default true). */
  verify?: boolean;
  /** Max age in ms (default CACHE_MAX_MS when verified, UNVERIFIED_MS otherwise). */
  ttlMs?: number;
  /** Absolute expiry derived from the value (e.g. next scheduled publish), or null. */
  expiresAt?: (value: T) => number | null;
};

export async function cachedRead<T>(key: string, sql: Sql, load: () => Promise<T>, options: CachedReadOptions<T> = {}): Promise<T> {
  const verify = options.verify ?? true;
  const gen = localGeneration;
  const token = verify ? await remoteToken(sql) : null;
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.gen === gen && hit.token === token && now < hit.expiresAt) return hit.value as T;
  const value = await load();
  if (value === null || value === undefined) return value;
  const ttl = options.ttlMs ?? (verify && token !== null ? CACHE_MAX_MS : UNVERIFIED_MS);
  const own = options.expiresAt?.(value) ?? null;
  const expiresAt = Math.min(now + ttl, own ?? Infinity);
  // A write in this isolate during the load makes the value suspect: don't keep it.
  if (gen === localGeneration && expiresAt > now) entries.set(key, { value, gen, token, expiresAt });
  return value;
}

/** Test hook. */
export function resetContentCache(): void {
  entries.clear();
  tokenMemo = null;
  localGeneration = 0;
}
