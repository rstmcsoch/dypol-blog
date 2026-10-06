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
  bytes: number;
  createdAt: string;
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
};

export function mediaObjectKey(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Media id is not a stable key.");
  }
  return `media/${id}`;
}

function rowToItem(row: MediaRow): StoredMedia {
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    alt: row.alt,
    bytes: Number(row.byte_size),
    createdAt: row.created_at,
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

export function createMediaStore(bucket: MediaBucket, db: MediaDatabase) {
  const ready = db.run(ENSURE_MEDIA_TABLE).catch((error) => {
    throw error;
  });
  return {
    ready,
    async list(): Promise<StoredMedia[]> {
      await ready;
      const rows = await db.all<MediaRow>(
        "select id, object_key, filename, mime, alt, byte_size, created_at from media order by created_at desc",
      );
      return rows.map(rowToItem);
    },
    async stats(): Promise<{ files: number; bytes: number }> {
      await ready;
      const rows = await db.all<{ files: number; bytes: number }>(
        "select count(*) as files, coalesce(sum(byte_size), 0) as bytes from media",
      );
      return { files: Number(rows[0]?.files ?? 0), bytes: Number(rows[0]?.bytes ?? 0) };
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
      } catch (error) {
        await bucket.delete(key).catch(() => undefined);
        throw error;
      }
    },
    async read(id: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
      await ready;
      const rows = await db.all<MediaRow>(
        "select id, object_key, filename, mime, alt, byte_size, created_at from media where id = ?",
        [id],
      );
      const row = rows[0];
      if (!row) return null;
      const object = await bucket.get(row.object_key);
      if (!object) return null;
      return { mime: object.contentType || row.mime, bytes: object.bytes };
    },
    async remove(id: string): Promise<boolean> {
      await ready;
      const rows = await db.all<{ object_key: string }>("select object_key from media where id = ?", [id]);
      const row = rows[0];
      if (!row) return false;
      await bucket.delete(row.object_key);
      await db.run("delete from media where id = ?", [id]);
      return true;
    },
  };
}

type R2Object = {
  arrayBuffer?: () => Promise<ArrayBuffer>;
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
 * Outside that runtime, the same MEDIA bucket and DB database are opened from
 * the declaration in cloudflare.config.ts. No other store is consulted.
 */
export async function readMediaBindings(): Promise<WorkerEnv | null> {
  const root = globalThis as { env?: unknown; __env__?: unknown };
  const scopes: unknown[] = [root.__env__, root.env, root];
  try {
    const specifier = ["cloudflare", "workers"].join(":");
    const mod = (await import(/* @vite-ignore */ specifier)) as { env?: unknown };
    scopes.unshift(mod.env);
  } catch {
    // Node (Vite, tests, Vercel) is not the Cloudflare worker.
  }
  for (const scope of scopes) {
    const env = envFrom(scope);
    if (env) return env;
  }
  const inWorker = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
  if (inWorker) return null;
  if (process.env.NODE_TEST_CONTEXT && process.env.DYPOL_MEDIA_PLATFORM !== "on") return null;
  try {
    const { openDeclaredBindings } = await import("./media-platform.server");
    return await openDeclaredBindings();
  } catch (error) {
    console.error("[media] The MEDIA and DB bindings could not be opened.", error);
    return null;
  }
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

let storePromise: Promise<ReturnType<typeof createMediaStore>> | null = null;

/** The MEDIA bucket and DB database declared in cloudflare.config.ts. */
export function openMediaStore() {
  storePromise ??= (async () => {
    const env = await readMediaBindings();
    if (!env?.MEDIA || !env.DB) throw new MediaBindingError();
    const store = createMediaStore(wrapBucket(env.MEDIA), wrapDatabase(env.DB));
    await store.ready;
    return store;
  })().catch((error) => {
    storePromise = null;
    throw error;
  });
  return storePromise;
}
