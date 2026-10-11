import { workerEnv, type D1Database } from "./cf-env.server";

/**
 * Server-only SQL client backed by the Cloudflare D1 binding `DB`
 * (database dypol-blog-db). Schema lives in migrations/d1 and is applied with
 * `wrangler d1 migrations apply DB` (local or --remote).
 *
 * The `Sql` surface (tagged template + `.query()` with $1..$n placeholders) is
 * kept so repository code reads like before. Postgres-only casts (`::jsonb`,
 * `::int`) are stripped and booleans are stored as 0/1 for SQLite.
 */
export interface Sql {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("The D1 binding DB is not available in this runtime.");
    this.name = "DatabaseUnavailableError";
  }
}

function toSqlite(text: string): string {
  return text.replace(/::(jsonb|json|int|integer|text)\b/g, "").replace(/\$(\d+)/g, "?$1");
}

function bindable(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function toSql(db: D1Database): Sql {
  const run = async <T>(text: string, params: unknown[]): Promise<T[]> => {
    const statement = db.prepare(toSqlite(text));
    const bound = params.length ? statement.bind(...params.map(bindable)) : statement;
    const result = await bound.all<T>();
    return result.results ?? [];
  };
  const sql = (async <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => run<T>(text, params);
  return sql;
}

export async function getSql(): Promise<Sql> {
  if (typeof window !== "undefined") {
    throw new Error("@/lib/db is server-only — call getSql() from a server function.");
  }
  const env = await workerEnv();
  if (!env.DB || typeof env.DB.prepare !== "function") throw new DatabaseUnavailableError();
  return toSql(env.DB);
}

/**
 * D1 has no interactive transactions. Statements run in order on the same
 * binding; callers validate before writing so a partial failure is unlikely.
 */
export async function withTransaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  return fn(await getSql());
}

/** Kept for the unused Better Auth PGLite path; D1 deployments never call it. */
export async function getPglite(): Promise<never> {
  throw new Error("PGLite is not available on Cloudflare Workers.");
}

export function ensureDbReady(): Promise<void> {
  return Promise.resolve();
}
