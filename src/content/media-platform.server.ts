/**
 * Node does not receive the worker's `env` automatically. This opens the same
 * bindings declared in cloudflare.config.ts and wrangler.json:
 *   MEDIA → R2 bucket dypol-blog-media
 *   DB    → D1 database dypol-blog-db
 * The bytes and the media rows stay on those bindings. There is no second store.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

type BucketBinding = {
  put(key: string, value: Uint8Array | ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{
    arrayBuffer?: () => Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
    body?: ReadableStream<Uint8Array> | null;
  } | null>;
  delete(key: string): Promise<void>;
};

type Statement = {
  bind(...values: unknown[]): Statement;
  all<T>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
};

type DatabaseBinding = {
  prepare(sql: string): Statement;
};

export type DeclaredBindings = {
  MEDIA: BucketBinding;
  DB: DatabaseBinding;
};

type Runtime = {
  ready: Promise<URL>;
  dispatchFetch(
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: Buffer | string },
  ): Promise<Response>;
  dispose(): Promise<void>;
};

const globalBindings = globalThis as typeof globalThis & {
  __dypolMediaPlatform__?: Promise<DeclaredBindings>;
  __dypolMediaRuntime__?: Promise<Runtime>;
};

function bytesOf(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

async function startRuntime(): Promise<Runtime> {
  const declared = JSON.parse(readFileSync(join(process.cwd(), "wrangler.json"), "utf8")) as {
    r2_buckets?: { binding?: string; bucket_name?: string }[];
    d1_databases?: { binding?: string; database_id?: string }[];
  };
  const bucket = declared.r2_buckets?.find((entry) => entry.binding === "MEDIA")?.bucket_name;
  const databaseId = declared.d1_databases?.find((entry) => entry.binding === "DB")?.database_id;
  if (!bucket || !databaseId) throw new Error("MEDIA and DB are not declared in wrangler.json.");
  const { Miniflare } = await import("miniflare");
  const runtime = new Miniflare({
    modules: true,
    script: WORKER,
    host: "127.0.0.1",
    port: 0,
    r2Buckets: { MEDIA: bucket },
    d1Databases: { DB: databaseId },
    r2Persist: join(process.cwd(), ".wrangler/state/r2"),
    d1Persist: join(process.cwd(), ".wrangler/state/d1"),
  });
  await runtime.ready;
  return runtime as Runtime;
}

function facade(runtime: Runtime): DeclaredBindings {
  return {
    MEDIA: {
      async put(key, value, options) {
        const body = Buffer.from(bytesOf(value));
        const response = await runtime.dispatchFetch(`http://media.local/object?key=${encodeURIComponent(key)}`, {
          method: "PUT",
          headers: { "content-type": options?.httpMetadata?.contentType ?? "application/octet-stream" },
          body,
        });
        if (!response.ok) throw new Error(await response.text());
      },
      async get(key) {
        const response = await runtime.dispatchFetch(`http://media.local/object?key=${encodeURIComponent(key)}`);
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(await response.text());
        const bytes = new Uint8Array(await response.arrayBuffer());
        const contentType = response.headers.get("content-type");
        return {
          arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          httpMetadata: { contentType: contentType ?? undefined },
        };
      },
      async delete(key) {
        const response = await runtime.dispatchFetch(`http://media.local/object?key=${encodeURIComponent(key)}`, {
          method: "DELETE",
        });
        if (!response.ok && response.status !== 404) throw new Error(await response.text());
      },
    },
    DB: {
      prepare(sql: string) {
        const statement = (params: unknown[]): Statement => ({
          bind(...values) {
            return statement(values);
          },
          async all<T>() {
            const response = await runtime.dispatchFetch("http://media.local/sql", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ sql, params, mode: "all" }),
            });
            if (!response.ok) throw new Error(await response.text());
            const payload = (await response.json()) as { results?: T[] };
            return { results: payload.results ?? [] };
          },
          async run() {
            const response = await runtime.dispatchFetch("http://media.local/sql", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ sql, params, mode: "run" }),
            });
            if (!response.ok) throw new Error(await response.text());
            return {};
          },
        });
        return statement([]);
      },
    },
  };
}

/** The MEDIA bucket and DB database from cloudflare.config.ts, inside the workers runtime. */
export function openDeclaredBindings(): Promise<DeclaredBindings> {
  if (!globalBindings.__dypolMediaRuntime__) {
    const runtime = startRuntime();
    globalBindings.__dypolMediaRuntime__ = runtime;
    globalBindings.__dypolMediaPlatform__ = runtime.then(facade).catch((error) => {
      globalBindings.__dypolMediaPlatform__ = undefined;
      globalBindings.__dypolMediaRuntime__ = undefined;
      throw error;
    });
  }
  return globalBindings.__dypolMediaPlatform__ ?? Promise.reject(new Error("MEDIA and DB bindings did not start."));
}

export async function closeDeclaredBindings(): Promise<void> {
  const runtime = globalBindings.__dypolMediaRuntime__;
  globalBindings.__dypolMediaPlatform__ = undefined;
  globalBindings.__dypolMediaRuntime__ = undefined;
  if (!runtime) return;
  await (await runtime).dispose();
}

const WORKER = `
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/object") {
        const key = url.searchParams.get("key") ?? "";
        if (!key.startsWith("media/") || key.includes("..")) {
          return new Response("Media key rejected.", { status: 400 });
        }
        if (request.method === "PUT") {
          const bytes = await request.arrayBuffer();
          await env.MEDIA.put(key, bytes, {
            httpMetadata: { contentType: request.headers.get("content-type") || "application/octet-stream" },
          });
          return new Response(null, { status: 204 });
        }
        if (request.method === "GET") {
          const object = await env.MEDIA.get(key);
          if (!object) return new Response("Not found", { status: 404 });
          return new Response(await object.arrayBuffer(), {
            headers: { "content-type": object.httpMetadata?.contentType || "application/octet-stream" },
          });
        }
        if (request.method === "DELETE") {
          await env.MEDIA.delete(key);
          return new Response(null, { status: 204 });
        }
        return new Response("Method not allowed", { status: 405 });
      }
      if (url.pathname === "/sql" && request.method === "POST") {
        const body = await request.json();
        let statement = env.DB.prepare(String(body.sql ?? ""));
        const params = Array.isArray(body.params) ? body.params : [];
        if (params.length > 0) statement = statement.bind(...params);
        if (body.mode === "all") {
          const result = await statement.all();
          return Response.json({ results: result.results ?? [] });
        }
        await statement.run();
        return Response.json({ results: [] });
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : "Binding request failed.", { status: 500 });
    }
  },
}
`;
