/**
 * t173: versioned special-article bodies. R2 holds immutable JSON versions,
 * D1 holds the pointer. All dependencies are injected so the ordering rules
 * are unit-testable (node:sqlite + in-memory bucket):
 *
 *   1. sanitize -> 2. R2 put of v{n} (failure: throw, D1 untouched)
 *   3. article rows (failure: orphan object removed, old pointer kept)
 *   4. version row + state pointer (failure: old pointer kept; object removed)
 *
 * Publishing re-checks that the pointed-to object exists in R2 first, so an
 * article can never be marked published without a readable body.
 *
 * R2 layout (bucket dypol-blog-media):
 *   special-articles/{id}/body/v{n}.json     immutable versions
 *   special-articles/{id}/body/autosave.json latest autosave (overwritten)
 *   special-articles/{id}/charts/{chartId}.svg
 */
import {
  buildBody,
  parseStoredBody,
  sanitizeSpecialContent,
  specialPlainText,
  specialWordCount,
  SPECIAL_MAX_BODY_BYTES,
  type SpecialBody,
  type SpecialContent,
} from "./body.ts";

export type StoreSql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type BucketLike = {
  put(key: string, value: string | ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string; cacheControl?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  head(key: string): Promise<unknown | null>;
  delete(keys: string | string[]): Promise<void>;
};

export class SpecialStoreError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const bodyKey = (id: string, version: number) => `special-articles/${id}/body/v${version}.json`;
export const autosaveKey = (id: string) => `special-articles/${id}/body/autosave.json`;
export const chartKey = (id: string, chartId: string) => `special-articles/${id}/charts/${chartId}.svg`;

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
export function assertId(id: string): string {
  if (!SAFE_ID.test(id)) throw new SpecialStoreError("Invalid article id.");
  return id;
}

async function sha256(textValue: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(textValue));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type VersionRow = { version: number; r2Key: string; sha256: string; bytes: number; wordCount: number; createdAt: string; createdBy: string; note: string };
export type SpecialState = { articleId: string; currentVersion: number; wordCount: number; autosaveAt: string | null; updatedAt: string };

export async function readState(sql: StoreSql, id: string): Promise<SpecialState | null> {
  const rows = await sql<{ article_id: string; current_version: number; word_count: number; autosave_at: string | null; updated_at: string }>`
    select article_id, current_version, word_count, autosave_at, updated_at from special_article_state where article_id = ${id}`;
  const r = rows[0];
  return r ? { articleId: r.article_id, currentVersion: Number(r.current_version), wordCount: Number(r.word_count), autosaveAt: r.autosave_at, updatedAt: r.updated_at } : null;
}

export async function listVersions(sql: StoreSql, id: string): Promise<VersionRow[]> {
  const rows = await sql<{ version: number; r2_key: string; sha256: string; bytes: number; word_count: number; created_at: string; created_by: string; note: string | null }>`
    select version, r2_key, sha256, bytes, word_count, created_at, created_by, note from special_article_versions where article_id = ${id} order by version desc limit 200`;
  return rows.map((r) => ({ version: Number(r.version), r2Key: r.r2_key, sha256: r.sha256, bytes: Number(r.bytes), wordCount: Number(r.word_count), createdAt: r.created_at, createdBy: r.created_by, note: r.note ?? "" }));
}

async function nextVersion(sql: StoreSql, id: string): Promise<number> {
  const rows = await sql<{ v: number | null }>`select max(version) as v from special_article_versions where article_id = ${id}`;
  return Number(rows[0]?.v ?? 0) + 1;
}

type Written = { version: number; key: string; sha: string; bytes: number; words: number; searchText: string };

/** Step 2: write an immutable version object. Throws SpecialStoreError (nothing in D1 changes). */
async function putVersion(bucket: BucketLike, id: string, version: number, content: SpecialContent, by: string): Promise<Written> {
  const body = buildBody(id, version, content);
  const json = JSON.stringify(body);
  const bytes = new TextEncoder().encode(json).byteLength;
  if (bytes > SPECIAL_MAX_BODY_BYTES) throw new SpecialStoreError("The article body is too large (2 MB max). Split it or remove some tables.");
  const sha = await sha256(json);
  const key = bodyKey(id, version);
  try {
    await bucket.put(key, json, {
      httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "private, max-age=0" },
      customMetadata: { sha256: sha, version: String(version), by: by.slice(0, 60) },
    });
  } catch (error) {
    console.error("[special] R2 put failed", key, error);
    throw new SpecialStoreError("Saving the article body to storage failed, so nothing was changed. Try again.", 503);
  }
  return { version, key, sha, bytes, words: specialWordCount(content.blocks), searchText: specialPlainText(content.blocks).slice(0, 200_000) };
}

/** Step 4: version row + pointer. On failure the previous pointer stays (the upsert is the last statement). */
async function commitPointer(sql: StoreSql, id: string, w: Written, by: string, note: string) {
  const now = new Date().toISOString();
  await sql`insert into special_article_versions (article_id, version, r2_key, sha256, bytes, word_count, created_at, created_by, note)
    values (${id}, ${w.version}, ${w.key}, ${w.sha}, ${w.bytes}, ${w.words}, ${now}, ${by.slice(0, 60)}, ${note.slice(0, 200)})`;
  await sql`insert into special_article_state (article_id, current_version, word_count, search_text, updated_at)
    values (${id}, ${w.version}, ${w.words}, ${w.searchText}, ${now})
    on conflict (article_id) do update set current_version = excluded.current_version, word_count = excluded.word_count,
      search_text = excluded.search_text, updated_at = excluded.updated_at`;
}

export type SaveRows = (articleId: string, isNew: boolean) => Promise<{ id: string; slug: string; status: string }>;

export type SaveDeps = {
  sql: StoreSql;
  bucket: BucketLike;
  /** Writes the D1 article metadata row(s); must use the given id. */
  saveRows: SaveRows;
  /** Optional media check: returns {width,height} for known media ids, null for unknown. */
  mediaInfo?: (mediaId: string) => Promise<{ width?: number; height?: number } | null>;
};

export async function isSpecial(sql: StoreSql, id: string): Promise<boolean> {
  const rows = await sql<{ t: string }>`select article_type as t from articles where id = ${id}`;
  return rows[0]?.t === "special";
}

export async function saveSpecialBody(deps: SaveDeps, input: { id: string | null; content: unknown; by: string; note?: string; newId?: () => string }) {
  const content = sanitizeSpecialContent(input.content);
  if (deps.mediaInfo) {
    for (const block of content.blocks) {
      if (block.type !== "image") continue;
      const info = await deps.mediaInfo(block.mediaId);
      if (!info) throw new SpecialStoreError(`Image ${block.mediaId} is not in the media library. Upload it first.`);
      if (info.width) block.width = info.width;
      if (info.height) block.height = info.height;
    }
  }
  const isNew = !input.id;
  const id = assertId(input.id ?? (input.newId ? input.newId() : crypto.randomUUID()));
  if (!isNew) {
    const rows = await deps.sql<{ t: string }>`select article_type as t from articles where id = ${id}`;
    if (!rows.length) throw new SpecialStoreError("That article no longer exists.", 404);
    if (rows[0].t !== "special") throw new SpecialStoreError("That is a normal article; open it in the normal editor.", 409);
  }
  const version = isNew ? 1 : await nextVersion(deps.sql, id);
  const written = await putVersion(deps.bucket, id, version, content, input.by);
  let saved: { id: string; slug: string; status: string };
  try {
    saved = await deps.saveRows(id, isNew);
    await commitPointer(deps.sql, id, written, input.by, input.note ?? "");
  } catch (error) {
    await deps.bucket.delete(written.key).catch(() => undefined);
    throw error;
  }
  return { ...saved, version, wordCount: written.words };
}

export async function readVersionBody(bucket: BucketLike, key: string): Promise<SpecialBody | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  try {
    return parseStoredBody(JSON.parse(await object.text()));
  } catch {
    return null;
  }
}

export async function readCurrentBody(sql: StoreSql, bucket: BucketLike, id: string): Promise<{ body: SpecialBody; version: number; key: string } | null> {
  const rows = await sql<{ r2_key: string; version: number }>`
    select v.r2_key, v.version from special_article_state s
    join special_article_versions v on v.article_id = s.article_id and v.version = s.current_version
    where s.article_id = ${id}`;
  const row = rows[0];
  if (!row) return null;
  const body = await readVersionBody(bucket, row.r2_key);
  return body ? { body, version: Number(row.version), key: row.r2_key } : null;
}

/** Throws unless the current pointer resolves to an existing R2 object. Call before any status=published write. */
export async function assertPublishable(sql: StoreSql, bucket: BucketLike, id: string): Promise<{ version: number; wordCount: number }> {
  const current = await readCurrentBody(sql, bucket, id).catch(() => null);
  if (!current) throw new SpecialStoreError("The article body is missing from storage, so it was not published. Save it again first.", 409);
  if (!current.body.blocks.some((b) => b.type !== "divider")) throw new SpecialStoreError("Add at least one block before publishing.");
  return { version: current.version, wordCount: specialWordCount(current.body.blocks) };
}

/** Rollback: re-saves an old version as a new version N+1 (history is never rewritten). */
export async function restoreVersion(sql: StoreSql, bucket: BucketLike, id: string, version: number, by: string) {
  const rows = await sql<{ r2_key: string }>`select r2_key from special_article_versions where article_id = ${id} and version = ${version}`;
  if (!rows[0]) throw new SpecialStoreError("That version does not exist.", 404);
  const old = await readVersionBody(bucket, rows[0].r2_key);
  if (!old) throw new SpecialStoreError("That version could not be read from storage.", 409);
  const content = sanitizeSpecialContent({ blocks: old.blocks, sources: old.sources, resources: old.resources, coverCredit: old.coverCredit });
  const next = await nextVersion(sql, id);
  const written = await putVersion(bucket, id, next, content, by);
  try {
    await commitPointer(sql, id, written, by, `Restored from v${version}`);
  } catch (error) {
    await bucket.delete(written.key).catch(() => undefined);
    throw error;
  }
  return { version: next, restoredFrom: version };
}

export async function writeAutosave(sql: StoreSql, bucket: BucketLike, id: string, content: unknown) {
  const clean = sanitizeSpecialContent(content);
  const json = JSON.stringify(buildBody(id, 0, clean));
  if (json.length > SPECIAL_MAX_BODY_BYTES) throw new SpecialStoreError("Autosave is too large.");
  await bucket.put(autosaveKey(id), json, { httpMetadata: { contentType: "application/json; charset=utf-8" } });
  const now = new Date().toISOString();
  await sql`update special_article_state set autosave_at = ${now} where article_id = ${id}`;
  return { savedAt: now };
}

export async function readAutosave(bucket: BucketLike, id: string): Promise<SpecialBody | null> {
  return readVersionBody(bucket, autosaveKey(id));
}

/** Best-effort cleanup after the article row is deleted (cascade removes D1 rows). */
export async function deleteSpecialObjects(bucket: BucketLike, keys: string[], id: string) {
  const all = [...keys, autosaveKey(id)];
  for (let i = 0; i < all.length; i += 500) await bucket.delete(all.slice(i, i + 500)).catch(() => undefined);
}

export async function versionKeys(sql: StoreSql, id: string): Promise<string[]> {
  const rows = await sql<{ r2_key: string }>`select r2_key from special_article_versions where article_id = ${id}`;
  return rows.map((r) => r.r2_key);
}
