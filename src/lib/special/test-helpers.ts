/** t173 test helpers: real migrations on node:sqlite + an in-memory R2 bucket. Test-only. */
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BucketLike, StoreSql } from "./store.ts";

export function migratedDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = on; create table d1_migrations (id integer primary key autoincrement, name text unique, applied_at text default current_timestamp);");
  const dir = join(import.meta.dirname, "../../../migrations/d1");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) db.exec(readFileSync(join(dir, f), "utf8"));
  return db;
}

export function sqlFor(db: DatabaseSync, opts: { failOn?: RegExp } = {}): StoreSql {
  const run = async <T>(text: string, params: unknown[] = []): Promise<T[]> => {
    if (opts.failOn?.test(text)) throw new Error("simulated D1 failure");
    const q = text.replace(/::[a-zA-Z_]+/g, "").replace(/\$(\d+)/g, "?$1");
    const bound = params.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v)) as never[];
    const stmt = db.prepare(q);
    return /^\s*(select|with)|returning/i.test(q) ? (stmt.all(...bound) as T[]) : (stmt.run(...bound), [] as T[]);
  };
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run(text, values);
  }) as unknown as StoreSql;
  sql.query = run as StoreSql["query"];
  return sql;
}

export class MemoryBucket implements BucketLike {
  objects = new Map<string, string>();
  failPut: RegExp | null = null;
  async put(key: string, value: string | ArrayBuffer | Uint8Array) {
    if (this.failPut?.test(key)) throw new Error("simulated R2 failure");
    this.objects.set(key, typeof value === "string" ? value : new TextDecoder().decode(value as ArrayBuffer));
    return {};
  }
  async get(key: string) {
    const v = this.objects.get(key);
    return v === undefined ? null : { text: async () => v };
  }
  async head(key: string) {
    return this.objects.has(key) ? {} : null;
  }
  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k);
  }
}

/** Minimal stand-in for saveArticleRows (metadata only), honouring the same id + type contract. */
export function fakeRows(sql: StoreSql, opts: { fail?: boolean } = {}) {
  return async (id: string, isNew: boolean) => {
    if (opts.fail) throw new Error("simulated metadata failure");
    const now = new Date().toISOString();
    if (isNew) {
      await sql`insert into articles (id, slug, title, excerpt, status, updated_at, category_id, motif, blocks) values (${id}, ${`s-${id}`}, 'T', 'E', 'draft', ${now}, 'cat-1', 'corner', '[]')`;
      await sql`update articles set article_type = 'special' where id = ${id}`;
    } else {
      await sql`update articles set updated_at = ${now} where id = ${id}`;
    }
    return { id, slug: `s-${id}`, status: "draft" };
  };
}

export function seedCategory(db: DatabaseSync) {
  db.exec("insert or ignore into categories (id, slug, label, description) values ('cat-1', 'tech', 'Tech', '')");
}
