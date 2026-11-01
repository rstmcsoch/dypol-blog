import { test } from "node:test";
import assert from "node:assert/strict";
import { cachedRead, isContentWrite, noteContentWrite, resetContentCache } from "./content-cache.server.ts";

test("isContentWrite matches reader-visible tables only", () => {
  for (const s of [
    "insert into articles (id) values (?1)",
    "  UPDATE articles set title = ?1",
    "delete from article_tags where article_id = ?1",
    "insert or replace into site_settings (id, data) values ('site', ?1)",
    "insert or ignore into categories (id) values (?1)",
    "update media set alt = ? where id = ?",
    "update pages set body = ?1",
  ]) assert.equal(isContentWrite(s), true, s);
  for (const s of [
    "select * from articles",
    "insert into article_views (article_id, views) values (?1, 1)",
    "insert into analytics_events (id) values (?1)",
    "update articles_fts set x = 1",
    "alter table media add column dominant_color text",
    "insert into content_version (id, v) values (1, 1)",
  ]) assert.equal(isContentWrite(s), false, s);
});

function fakeSql(version: { v: number | null }) {
  const sql = (async () => []) as unknown as { query: (t: string) => Promise<unknown[]> };
  sql.query = async () => {
    if (version.v === null) throw new Error("no such table");
    return [{ v: version.v }];
  };
  return sql as never;
}

test("cachedRead reuses until the shared version or a local write changes", async () => {
  resetContentCache();
  const version = { v: 1 };
  const sql = fakeSql(version);
  let loads = 0;
  const load = async () => ({ n: ++loads });
  assert.equal((await cachedRead("k", sql, load)).n, 1);
  assert.equal((await cachedRead("k", sql, load)).n, 1);
  version.v = 2;
  await new Promise((r) => setTimeout(r, 1_050)); // token memo is 1 s
  assert.equal((await cachedRead("k", sql, load)).n, 2);
  await noteContentWrite();
  assert.equal((await cachedRead("k", sql, load)).n, 3);
  // An already-passed own expiry (e.g. due scheduled post) is never cached.
  const expired = async () => ({ n: ++loads });
  await cachedRead("s", sql, expired, { expiresAt: () => Date.now() - 1 });
  assert.equal((await cachedRead("s", sql, expired, { expiresAt: () => Date.now() - 1 })).n, loads);
  // null (e.g. table missing) is never cached
  let nulls = 0;
  await cachedRead("z", sql, async () => { nulls++; return null; });
  await cachedRead("z", sql, async () => { nulls++; return null; });
  assert.equal(nulls, 2);
});
