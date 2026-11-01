/**
 * Journal images use the bindings already declared in cloudflare.config.ts:
 *   MEDIA — R2 bucket dypol-blog-media (object bytes)
 *   DB    — D1 database dypol-blog-db (filename, alt, mime, size, key)
 *
 * There is no second bucket, no local file store, and no image blob column.
 * Postgres keeps references only (cover, logo, favicon).
 */

export const MEDIA_BUCKET_NAME = "dypol-blog-media";
export const D1_DATABASE_NAME = "dypol-blog-db";
export const D1_DATABASE_ID = "78708341-8467-4140-bfa7-0531f14a7aee";

export class MediaBindingError extends Error {
  constructor() {
    super(
      `The MEDIA R2 binding is not available in this runtime. Image files belong in the ${MEDIA_BUCKET_NAME} bucket, and their records belong in D1 (${D1_DATABASE_NAME}, ${D1_DATABASE_ID}).`,
    );
    this.name = "MediaBindingError";
  }
}

export type StoredMedia = {
  id: string;
  filename: string;
  mime: string;
  alt: string;
  /** Original uploaded bytes (byte_size). */
  bytes: number;
  createdAt: string;
  /** t60 variants: stored bytes per variant (0 when absent). */
  heroBytes: number;
  thumbBytes: number;
  width: number;
  height: number;
  /** "images-binding" | "original-within-target" | "legacy" | backfill value. */
  processing: string;
  hasVariants: boolean;
};

export type MediaStorageStats = {
  files: number;
  /** Bytes actually stored in R2: hero (or legacy original) + thumb. */
  storedBytes: number;
  /** Sum of original upload sizes, for before/after comparison. */
  originalBytes: number;
  variantBytes: number;
};

export type MediaBucket = {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string | null } | null>;
  delete(key: string): Promise<void>;
};

export type MediaDatabase = {
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<void>;
};

type MediaRow = {
  id: string;
  object_key: string;
  filename: string;
  mime: string;
  alt: string;
  byte_size: number;
  created_at: string;
  hero_key?: string | null;
  thumb_key?: string | null;
  hero_byte_size?: number;
  thumb_byte_size?: number;
  width?: number;
  height?: number;
  processing?: string;
};

const MEDIA_COLUMNS =
  "id, object_key, filename, mime, alt, byte_size, created_at, hero_key, thumb_key, hero_byte_size, thumb_byte_size, width, height, processing";

export function heroObjectKey(id: string, contentType = "image/webp"): string {
  return `${mediaObjectKey(id)}/hero.${contentType === "image/webp" ? "webp" : extensionForMime(contentType)}`;
}

export function thumbObjectKey(id: string, contentType = "image/webp"): string {
  return `${mediaObjectKey(id)}/thumb.${contentType === "image/webp" ? "webp" : extensionForMime(contentType)}`;
}

function extensionForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/gif") return "gif";
  return "webp";
}

export function mediaObjectKey(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Media id is not a stable key.");
  }
  return `media/${id}`;
}

function rowToItem(row: MediaRow): StoredMedia {
  const heroBytes = Number(row.hero_byte_size ?? 0);
  const thumbBytes = Number(row.thumb_byte_size ?? 0);
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    alt: row.alt,
    bytes: Number(row.byte_size),
    createdAt: row.created_at,
    heroBytes,
    thumbBytes,
    width: Number(row.width ?? 0),
    height: Number(row.height ?? 0),
    processing: row.processing || "legacy",
    hasVariants: Boolean(row.hero_key),
  };
}

const ENSURE_MEDIA_TABLE = `create table if not exists media (
  id text primary key,
  object_key text not null unique,
  filename text not null,
  mime text not null,
  alt text not null default '',
  byte_size integer not null,
  created_at text not null
)`;

/** t60 variant columns (migration 0009). Added idempotently so local
 * databases created before 0009 keep working; duplicate-column errors
 * are expected and swallowed. */
const ENSURE_MEDIA_VARIANT_COLUMNS = [
  "alter table media add column hero_key text",
  "alter table media add column thumb_key text",
  "alter table media add column hero_byte_size integer not null default 0",
  "alter table media add column thumb_byte_size integer not null default 0",
  "alter table media add column width integer not null default 0",
  "alter table media add column height integer not null default 0",
  "alter table media add column processing text not null default 'legacy'",
];

/**
 * t147: a short, stable token for a media row's served bytes. It changes
 * whenever the objects behind /media/<id> change (backfill writes variants,
 * a re-upload changes sizes), so `?v=<token>` URLs can be cached immutably.
 */
export function mediaVersion(row: {
  object_key?: string | null;
  hero_key?: string | null;
  thumb_key?: string | null;
  byte_size?: number | null;
  hero_byte_size?: number | null;
  thumb_byte_size?: number | null;
}): string {
  const source = [row.hero_key || row.object_key || "", row.thumb_key || "", Number(row.byte_size ?? 0), Number(row.hero_byte_size ?? 0), Number(row.thumb_byte_size ?? 0)].join("|");
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export function createMediaStore(bucket: MediaBucket, db: MediaDatabase, options: { ensureSchema?: boolean } = {}) {
  const ready = options.ensureSchema === false ? Promise.resolve() : (async () => {
    await db.run(ENSURE_MEDIA_TABLE);
    for (const statement of ENSURE_MEDIA_VARIANT_COLUMNS) {
      try {
        await db.run(statement);
      } catch {
        // Column already exists (migration 0009 applied) — fine.
      }
    }
  })();
  return {
    ready,
    async list(): Promise<StoredMedia[]> {
      await ready;
      const rows = await db.all<MediaRow>(`select ${MEDIA_COLUMNS} from media order by created_at desc`);
      return rows.map(rowToItem);
    },
    async stats(): Promise<{ files: number; bytes: number }> {
      const detailed = await this.storageStats();
      return { files: detailed.files, bytes: detailed.storedBytes };
    },
    /** Storage accounting including variants (t60 §storage). */
    async storageStats(): Promise<MediaStorageStats> {
      await ready;
      const rows = await db.all<{ files: number; bytes: number; original_bytes: number; variant_bytes: number }>(
        "select count(*) as files, coalesce(sum(coalesce(nullif(hero_byte_size, 0), byte_size) + thumb_byte_size), 0) as bytes, coalesce(sum(byte_size), 0) as original_bytes, coalesce(sum(hero_byte_size + thumb_byte_size), 0) as variant_bytes from media",
      );
      const row = rows[0];
      return {
        files: Number(row?.files ?? 0),
        storedBytes: Number(row?.bytes ?? 0),
        originalBytes: Number(row?.original_bytes ?? 0),
        variantBytes: Number(row?.variant_bytes ?? 0),
      };
    },
    async exists(id: string): Promise<boolean> {
      await ready;
      const rows = await db.all<{ id: string }>("select id from media where id = ?", [id]);
      return rows.length > 0;
    },
    async put(input: {
      id: string;
      filename: string;
      mime: string;
      alt: string;
      bytes: Uint8Array;
      createdAt: string;
    }): Promise<void> {
      await ready;
      const key = mediaObjectKey(input.id);
      await bucket.put(key, input.bytes, input.mime);
      try {
        await db.run(
          "insert into media (id, object_key, filename, mime, alt, byte_size, created_at) values (?, ?, ?, ?, ?, ?, ?)",
          [input.id, key, input.filename, input.mime, input.alt, input.bytes.byteLength, input.createdAt],
        );
        forgetServedMedia(input.id);
      } catch (error) {
        await bucket.delete(key).catch(() => undefined);
        throw error;
      }
    },
    /**
     * Store an upload that has already been processed by the image
     * pipeline. Both R2 objects are written first; if the D1 insert
     * fails, every object written for this upload is deleted, so a
     * failed upload never leaves partial media behind.
     */
    async putProcessed(input: {
      id: string;
      filename: string;
      mime: string;
      alt: string;
      originalByteSize: number;
      hero: { bytes: Uint8Array; contentType: string; width: number; height: number };
      /** null reuses the hero object as the thumb (documented fallback). */
      thumb: { bytes: Uint8Array; contentType: string } | null;
      processing: string;
      createdAt: string;
    }): Promise<void> {
      await ready;
      const heroKey = heroObjectKey(input.id, input.hero.contentType);
      const thumbKey = input.thumb ? thumbObjectKey(input.id, input.thumb.contentType) : heroKey;
      const written: string[] = [];
      try {
        await bucket.put(heroKey, input.hero.bytes, input.hero.contentType);
        written.push(heroKey);
        if (input.thumb && thumbKey !== heroKey) {
          await bucket.put(thumbKey, input.thumb.bytes, input.thumb.contentType);
          written.push(thumbKey);
        }
        await db.run(
          "insert into media (id, object_key, filename, mime, alt, byte_size, created_at, hero_key, thumb_key, hero_byte_size, thumb_byte_size, width, height, processing) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            input.id,
            heroKey,
            input.filename,
            input.mime,
            input.alt,
            input.originalByteSize,
            input.createdAt,
            heroKey,
            thumbKey,
            input.hero.bytes.byteLength,
            input.thumb ? input.thumb.bytes.byteLength : 0,
            input.hero.width,
            input.hero.height,
            input.processing,
          ],
        );
        forgetServedMedia(input.id);
      } catch (error) {
        for (const key of [...new Set(written)]) {
          await bucket.delete(key).catch(() => undefined);
        }
        throw error;
      }
    },
    /** Legacy rows (uploaded before t60) that have no variants yet. */
    async legacyBatch(limit: number): Promise<StoredMedia[]> {
      await ready;
      const rows = await db.all<MediaRow>(
        `select ${MEDIA_COLUMNS} from media where hero_key is null order by created_at asc limit ?`,
        [Math.max(1, Math.min(100, Math.floor(limit) || 10))],
      );
      return rows.map(rowToItem);
    },
    /**
     * Backfill one legacy row: write variant objects, then point the
     * row at them. Idempotent — a row that already has variants is
     * skipped untouched. On D1 failure the new objects are deleted.
     */
    async recordVariants(input: {
      id: string;
      hero: { bytes: Uint8Array; contentType: string; width: number; height: number };
      thumb: { bytes: Uint8Array; contentType: string } | null;
      processing: string;
    }): Promise<boolean> {
      await ready;
      const rows = await db.all<MediaRow>(`select ${MEDIA_COLUMNS} from media where id = ?`, [input.id]);
      const row = rows[0];
      if (!row || row.hero_key) return false;
      const heroKey = heroObjectKey(input.id, input.hero.contentType);
      const thumbKey = input.thumb ? thumbObjectKey(input.id, input.thumb.contentType) : heroKey;
      const written: string[] = [];
      try {
        await bucket.put(heroKey, input.hero.bytes, input.hero.contentType);
        written.push(heroKey);
        if (input.thumb && thumbKey !== heroKey) {
          await bucket.put(thumbKey, input.thumb.bytes, input.thumb.contentType);
          written.push(thumbKey);
        }
        await db.run(
          "update media set hero_key = ?, thumb_key = ?, hero_byte_size = ?, thumb_byte_size = ?, width = ?, height = ?, processing = ? where id = ? and hero_key is null",
          [
            heroKey,
            thumbKey,
            input.hero.bytes.byteLength,
            input.thumb ? input.thumb.bytes.byteLength : 0,
            input.hero.width,
            input.hero.height,
            input.processing,
            input.id,
          ],
        );
        forgetServedMedia(input.id);
      } catch (error) {
        for (const key of [...new Set(written)]) {
          await bucket.delete(key).catch(() => undefined);
        }
        throw error;
      }
      return true;
    },
    async read(id: string, variant: "hero" | "thumb" = "hero"): Promise<{ mime: string; bytes: Uint8Array } | null> {
      await ready;
      const rows = await db.all<MediaRow>(`select ${MEDIA_COLUMNS} from media where id = ?`, [id]);
      const row = rows[0];
      if (!row) return null;
      // Legacy rows (no variants) fall back to the original object.
      const key = variant === "thumb" ? row.thumb_key || row.hero_key || row.object_key : row.hero_key || row.object_key;
      const object = await bucket.get(key);
      if (!object) {
        // Variant object missing (partial legacy state): serve the original.
        if (key !== row.object_key) {
          const original = await bucket.get(row.object_key);
          if (original) return { mime: original.contentType || row.mime, bytes: original.bytes };
        }
        return null;
      }
      return { mime: object.contentType || (key.endsWith(".webp") ? "image/webp" : row.mime), bytes: object.bytes };
    },
    async remove(id: string): Promise<boolean> {
      await ready;
      const rows = await db.all<{ object_key: string; hero_key?: string | null; thumb_key?: string | null }>(
        `select ${MEDIA_COLUMNS} from media where id = ?`,
        [id],
      );
      const row = rows[0];
      if (!row) return false;
      for (const key of [...new Set([row.object_key, row.hero_key, row.thumb_key].filter(Boolean) as string[])]) {
        await bucket.delete(key);
      }
      await db.run("delete from media where id = ?", [id]);
      forgetServedMedia(id);
      return true;
    },
  };
}

type R2Object = {
  arrayBuffer?: () => Promise<ArrayBuffer>;
  size?: number;
  httpEtag?: string;
  httpMetadata?: { contentType?: string };
  body?: ReadableStream<Uint8Array> | null;
};

type R2BucketBinding = {
  put(key: string, value: Uint8Array | ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<R2Object | null>;
  delete(key: string): Promise<void>;
};

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  all<T>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
};

type D1Binding = {
  prepare(sql: string): D1Statement;
};

type WorkerEnv = {
  MEDIA?: R2BucketBinding;
  DB?: D1Binding;
};

function isBucket(value: unknown): value is R2BucketBinding {
  if (!value || typeof value !== "object") return false;
  const bucket = value as R2BucketBinding;
  return typeof bucket.put === "function" && typeof bucket.get === "function" && typeof bucket.delete === "function";
}

function isDatabase(value: unknown): value is D1Binding {
  if (!value || typeof value !== "object") return false;
  return typeof (value as D1Binding).prepare === "function";
}

function envFrom(scope: unknown): WorkerEnv | null {
  if (!scope || typeof scope !== "object") return null;
  const record = scope as WorkerEnv;
  if (!isBucket(record.MEDIA) || !isDatabase(record.DB)) return null;
  return { MEDIA: record.MEDIA, DB: record.DB };
}

/**
 * The worker injects bindings on `cloudflare:workers` (`env.MEDIA`, `env.DB`).
 * Outside that runtime there is no store: uploads fail with MediaBindingError.
 */
export async function readMediaBindings(): Promise<WorkerEnv | null> {
  const root = globalThis as { env?: unknown; __env__?: unknown };
  const scopes: unknown[] = [root.__env__, root.env, root];
  try {
    const specifier = ["cloudflare", "workers"].join(":");
    const mod = (await import(/* @vite-ignore */ specifier)) as { env?: unknown };
    scopes.unshift(mod.env);
  } catch {
    // Outside the Cloudflare runtime (node tests) there are no bindings.
  }
  for (const scope of scopes) {
    const env = envFrom(scope);
    if (env) return env;
  }
  return null;
}

function wrapBucket(binding: R2BucketBinding): MediaBucket {
  return {
    async put(key, bytes, contentType) {
      const body = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes
        : bytes.slice();
      await binding.put(key, body, { httpMetadata: { contentType } });
    },
    async get(key) {
      const object = await binding.get(key);
      if (!object) return null;
      const bytes = object.arrayBuffer
        ? new Uint8Array(await object.arrayBuffer())
        : object.body
          ? new Uint8Array(await new Response(object.body).arrayBuffer())
          : null;
      if (!bytes) return null;
      return { bytes, contentType: object.httpMetadata?.contentType ?? null };
    },
    delete(key) {
      return binding.delete(key);
    },
  };
}

function wrapDatabase(binding: D1Binding): MediaDatabase {
  const statement = (sql: string, params: unknown[]) => {
    const prepared = binding.prepare(sql);
    return params.length > 0 ? prepared.bind(...params) : prepared;
  };
  return {
    async all<T>(sql: string, params: unknown[] = []) {
      const result = await statement(sql, params).all<T>();
      return result.results ?? [];
    },
    async run(sql: string, params: unknown[] = []) {
      await statement(sql, params).run();
    },
  };
}

/**
 * The MEDIA bucket and DB database bindings. A fresh store per call: workerd
 * hangs a request that awaits a promise created by another request.
 */
export async function openMediaStore() {
  const env = await readMediaBindings();
  if (!env?.MEDIA || !env.DB) throw new MediaBindingError();
  // t147: the idempotent DDL used to run on every request (9 sequential D1
  // round trips to the APAC primary per image). It now runs once per isolate;
  // a plain flag, not a shared promise (see the note above).
  const store = createMediaStore(wrapBucket(env.MEDIA), wrapDatabase(env.DB), { ensureSchema: !schemaChecked });
  await store.ready;
  schemaChecked = true;
  return store;
}

let schemaChecked = false;

type ServeRow = Pick<MediaRow, "object_key" | "mime" | "hero_key" | "thumb_key" | "byte_size" | "hero_byte_size" | "thumb_byte_size">;

/** Per-isolate media row cache for the public /media route (t147). */
const SERVE_TTL_MS = 5 * 60_000;
const SERVE_MAX = 500;
const serveRows = new Map<string, { row: ServeRow | null; at: number }>();

/** Drops cached rows after a write in this isolate (other isolates expire by TTL; `?v=` mismatches re-read). */
export function forgetServedMedia(id?: string): void {
  if (id) serveRows.delete(id);
  else serveRows.clear();
}

async function serveRow(db: D1Binding, id: string, fresh: boolean): Promise<ServeRow | null> {
  const hit = serveRows.get(id);
  if (!fresh && hit && Date.now() - hit.at < SERVE_TTL_MS) return hit.row;
  const select = () =>
    db.prepare("select object_key, mime, hero_key, thumb_key, byte_size, hero_byte_size, thumb_byte_size from media where id = ?").bind(id).all<ServeRow>();
  let result: { results?: ServeRow[] };
  try {
    result = await select();
  } catch {
    // Pre-migration local database: create the table/columns once, then retry.
    await openMediaStore();
    result = await select();
  }
  const row = result.results?.[0] ?? null;
  if (serveRows.size >= SERVE_MAX) {
    const oldest = serveRows.keys().next().value;
    if (oldest !== undefined) serveRows.delete(oldest);
  }
  serveRows.set(id, { row, at: Date.now() });
  return row;
}

export type ServedMedia = {
  /** Current version token (compare with ?v=). */
  version: string;
  /** True when the row has no variants yet (the original is being served). */
  legacy: boolean;
  etag: string;
  mime: string;
  /** null for a 304 (no R2 read was needed). */
  body: ReadableStream<Uint8Array> | null;
  size: number | null;
};

/**
 * t147 fast path for GET /media/<id>: one D1 select (cached per isolate),
 * one R2 get, and the R2 body streamed straight through (no buffering).
 * `ifNoneMatch` short-circuits before R2 when the client already has it.
 */
export async function serveMedia(
  id: string,
  variant: "hero" | "thumb",
  options: { requestedVersion?: string | null; ifNoneMatch?: string | null; fresh?: boolean } = {},
): Promise<ServedMedia | null> {
  const env = await readMediaBindings();
  if (!env?.MEDIA || !env.DB) throw new MediaBindingError();
  let row = await serveRow(env.DB, id, options.fresh === true);
  // A stale cached row must never be pinned under a newer immutable URL.
  if (row && options.requestedVersion && options.requestedVersion !== mediaVersion(row)) row = await serveRow(env.DB, id, true);
  if (!row) return null;
  const version = mediaVersion(row);
  const key = variant === "thumb" ? row.thumb_key || row.hero_key || row.object_key : row.hero_key || row.object_key;
  const etag = `"${version}-${variant === "thumb" && row.thumb_key ? "t" : "h"}"`;
  const fallbackMime = key.endsWith(".webp") ? "image/webp" : row.mime;
  if (options.ifNoneMatch && options.ifNoneMatch.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag)) {
    return { version, legacy: !row.hero_key, etag, mime: fallbackMime, body: null, size: null };
  }
  const cacheKey = `${key}|${version}`;
  const cached = byteCache.get(cacheKey);
  if (cached) {
    // Refresh LRU position.
    byteCache.delete(cacheKey);
    byteCache.set(cacheKey, cached);
    return { version, legacy: !row.hero_key, etag: cached.etag, mime: cached.mime, body: new Response(cached.bytes).body, size: cached.bytes.byteLength };
  }
  let object = await env.MEDIA.get(key);
  let original = false;
  if (!object && key !== row.object_key) {
    // Variant object missing (partial legacy state): serve the original.
    object = await env.MEDIA.get(row.object_key);
    original = true;
  }
  if (!object) return null;
  const mime = object.httpMetadata?.contentType || (original ? row.mime : fallbackMime);
  const servedEtag = original ? `"${version}-o"` : etag;
  const size = typeof object.size === "number" ? object.size : null;
  if (!original && row.hero_key && size !== null && size <= BYTE_CACHE_ENTRY_MAX && object.arrayBuffer) {
    // Small optimized variants are kept in isolate memory (keyed by version,
    // so a changed image can never be served from here).
    const bytes = new Uint8Array(await object.arrayBuffer());
    rememberBytes(cacheKey, { bytes, mime, etag: servedEtag });
    return { version, legacy: false, etag: servedEtag, mime, body: new Response(bytes).body, size: bytes.byteLength };
  }
  const body = object.body ?? (object.arrayBuffer ? new Response(await object.arrayBuffer()).body : null);
  return { version, legacy: !row.hero_key, etag: servedEtag, mime, body, size };
}

/** t147: per-isolate LRU of small variant bytes (~all covers fit in a few MB). */
const BYTE_CACHE_ENTRY_MAX = 300_000;
const BYTE_CACHE_BUDGET = 24_000_000;
let byteCacheTotal = 0;
const byteCache = new Map<string, { bytes: Uint8Array<ArrayBuffer>; mime: string; etag: string }>();
function rememberBytes(key: string, entry: { bytes: Uint8Array<ArrayBuffer>; mime: string; etag: string }): void {
  if (byteCache.has(key)) return;
  byteCache.set(key, entry);
  byteCacheTotal += entry.bytes.byteLength;
  while (byteCacheTotal > BYTE_CACHE_BUDGET) {
    const oldest = byteCache.keys().next().value;
    if (oldest === undefined) break;
    byteCacheTotal -= byteCache.get(oldest)?.bytes.byteLength ?? 0;
    byteCache.delete(oldest);
  }
}
