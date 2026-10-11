/**
 * Cloudflare Worker bindings (server-only).
 *
 * The Worker runtime exposes bindings on the `cloudflare:workers` module. The
 * specifier is built at runtime so node-based tests and type tooling never try
 * to resolve it. Outside the Worker this returns an empty object.
 */
export type D1Result<T> = { results?: T[] };
export type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
};
export type D1Database = {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
};

export type WorkerBindings = {
  DB?: D1Database;
  MEDIA?: unknown;
  ADMIN_TOKEN?: string;
  ADMIN_SESSION_SECRET?: string;
};

let cached: Promise<WorkerBindings> | null = null;

export function workerEnv(): Promise<WorkerBindings> {
  cached ??= (async () => {
    try {
      const specifier = ["cloudflare", "workers"].join(":");
      const mod = (await import(/* @vite-ignore */ specifier)) as { env?: WorkerBindings };
      return mod.env ?? {};
    } catch {
      return {};
    }
  })();
  return cached;
}
