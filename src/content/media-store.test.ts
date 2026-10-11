import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  MEDIA_BUCKET_NAME,
  MediaBindingError,
  createMediaStore,
  mediaObjectKey,
  openMediaStore,
  type MediaBucket,
  type MediaDatabase,
} from "./media-store.server.ts";

const id = "11111111-1111-4111-8111-111111111111";

function memory() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const rows: Record<string, unknown>[] = [];
  const bucket: MediaBucket = {
    async put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType });
    },
    async get(key) {
      const object = objects.get(key);
      return object ? { bytes: object.bytes, contentType: object.contentType } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  const db: MediaDatabase = {
    async all(sql, params = []) {
      if (sql.startsWith("select count")) {
        const bytes = rows.reduce((sum, row) => sum + Number(row.byte_size), 0);
        return [{ files: rows.length, bytes }] as never;
      }
      if (sql.includes("where id = ?") && sql.includes("object_key, filename")) {
        return rows.filter((row) => row.id === params[0]) as never;
      }
      if (sql.includes("where id = ?")) {
        return rows.filter((row) => row.id === params[0]).map((row) => ({ id: row.id, object_key: row.object_key })) as never;
      }
      return [...rows].reverse() as never;
    },
    async run(sql, params = []) {
      if (sql.startsWith("create")) return;
      if (sql.startsWith("insert")) {
        rows.push({
          id: params[0],
          object_key: params[1],
          filename: params[2],
          mime: params[3],
          alt: params[4],
          byte_size: params[5],
          created_at: params[6],
        });
        return;
      }
      const index = rows.findIndex((row) => row.id === params[0]);
      if (index >= 0) rows.splice(index, 1);
    },
  };
  return { objects, rows, store: createMediaStore(bucket, db) };
}

test("object keys stay inside the media prefix and match the declared bindings", () => {
  assert.equal(MEDIA_BUCKET_NAME, "dypol-blog-media");
  assert.equal(D1_DATABASE_NAME, "dypol-blog-db");
  assert.equal(D1_DATABASE_ID, "78708341-8467-4140-bfa7-0531f14a7aee");
  assert.equal(mediaObjectKey(id), `media/${id}`);
  assert.throws(() => mediaObjectKey("../etc/passwd"));
  const config = JSON.parse(readFileSync(new URL("../../wrangler.json", import.meta.url), "utf8")) as {
    r2_buckets: { binding: string; bucket_name: string; remote?: boolean }[];
    d1_databases: { binding: string; database_name: string; database_id: string; remote?: boolean }[];
  };
  assert.equal(config.r2_buckets[0]?.binding, "MEDIA");
  assert.equal(config.r2_buckets[0]?.bucket_name, MEDIA_BUCKET_NAME);
  assert.equal(config.r2_buckets[0]?.remote, false);
  assert.equal(config.d1_databases[0]?.binding, "DB");
  assert.equal(config.d1_databases[0]?.database_name, D1_DATABASE_NAME);
  assert.equal(config.d1_databases[0]?.database_id, D1_DATABASE_ID);
  assert.equal(config.d1_databases[0]?.remote, false);
});

test("a file is written to the bucket and only a reference is written to the database", async () => {
  const { objects, rows, store } = memory();
  const bytes = new Uint8Array([137, 80, 78, 71]);
  await store.put({
    id,
    filename: "mark.png",
    mime: "image/png",
    alt: "Orange test mark",
    bytes,
    createdAt: "2026-10-06T10:00:00.000Z",
  });
  assert.equal(objects.get(`media/${id}`)?.contentType, "image/png");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.object_key, `media/${id}`);
  assert.equal("bytes" in (rows[0] ?? {}), false);
  const read = await store.read(id);
  assert.deepEqual(read?.bytes, bytes);
  const stats = await store.stats();
  assert.deepEqual(stats, { files: 1, bytes: 4 });
  assert.equal(await store.remove(id), true);
  assert.equal(objects.size, 0);
  assert.equal(rows.length, 0);
});

test("a database failure removes the object that was just uploaded", async () => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const failing = createMediaStore(
    {
      async put(key, bytes, contentType) {
        objects.set(key, { bytes, contentType });
      },
      async get() {
        return null;
      },
      async delete(key) {
        objects.delete(key);
      },
    },
    {
      async all() {
        return [];
      },
      async run(sql) {
        if (sql.startsWith("create")) return;
        throw new Error("d1 down");
      },
    },
  );
  await assert.rejects(() =>
    failing.put({
      id,
      filename: "mark.png",
      mime: "image/png",
      alt: "",
      bytes: new Uint8Array([1]),
      createdAt: "2026-10-06T10:00:00.000Z",
    }),
  );
  assert.equal(objects.size, 0);
});

test("openMediaStore uses the MEDIA and DB bindings and refuses any other store", async () => {
  const root = globalThis as { __env__?: unknown; env?: unknown; MEDIA?: unknown; DB?: unknown };
  const previousEnv = root.__env__;
  const previousAlias = root.env;
  root.__env__ = undefined;
  delete root.MEDIA;
  delete root.DB;
  await assert.rejects(openMediaStore, MediaBindingError);

  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const rows: Record<string, unknown>[] = [];
  root.__env__ = {
    MEDIA: {
      async put(key: string, bytes: Uint8Array, options?: { httpMetadata?: { contentType?: string } }) {
        objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType ?? "" });
      },
      async get(key: string) {
        const object = objects.get(key);
        if (!object) return null;
        return {
          arrayBuffer: async () =>
            object.bytes.buffer.slice(object.bytes.byteOffset, object.bytes.byteOffset + object.bytes.byteLength),
          httpMetadata: { contentType: object.contentType },
        };
      },
      async delete(key: string) {
        objects.delete(key);
      },
    },
    DB: {
      prepare(sql: string) {
        const exec = (params: unknown[]) => {
          if (sql.startsWith("create")) return { results: [] as unknown[] };
          if (sql.startsWith("insert")) {
            rows.push({
              id: params[0],
              object_key: params[1],
              filename: params[2],
              mime: params[3],
              alt: params[4],
              byte_size: params[5],
              created_at: params[6],
            });
            return { results: [] as unknown[] };
          }
          if (sql.startsWith("delete")) {
            const index = rows.findIndex((row) => row.id === params[0]);
            if (index >= 0) rows.splice(index, 1);
            return { results: [] as unknown[] };
          }
          if (sql.startsWith("select count")) {
            const bytes = rows.reduce((sum, row) => sum + Number(row.byte_size), 0);
            return { results: [{ files: rows.length, bytes }] };
          }
          if (sql.includes("where id = ?")) return { results: rows.filter((row) => row.id === params[0]) };
          return { results: [...rows].reverse() };
        };
        const statement = (params: unknown[]) => ({
          bind: (...next: unknown[]) => statement(next),
          all: async () => exec(params),
          run: async () => exec(params),
        });
        return statement([]);
      },
    },
  };

  try {
    const store = await openMediaStore();
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await store.put({
      id,
      filename: "mark.png",
      mime: "image/png",
      alt: "Orange test mark",
      bytes,
      createdAt: "2026-10-06T10:00:00.000Z",
    });
    assert.equal(objects.get(`media/${id}`)?.contentType, "image/png");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.object_key, `media/${id}`);
    assert.equal("bytes" in (rows[0] ?? {}), false);
    const read = await store.read(id);
    assert.deepEqual(Array.from(read?.bytes ?? []), Array.from(bytes));
  } finally {
    root.__env__ = previousEnv;
    root.env = previousAlias;
  }
});
