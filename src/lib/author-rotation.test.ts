import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { checkAuthorList, cursorAfterEdit, MAX_AUTHORS, moveItem, nameFromTurnRow, nextUpName, slotFor, takeTurn, TAKE_TURN_SQL } from "./author-rotation.ts";

const run = (names: string[], n: number, start = 0) => {
  const out: string[] = [];
  let cursor = start;
  for (let i = 0; i < n; i++) { const t = takeTurn(names, cursor); out.push(t.name ?? "-"); cursor = t.cursor; }
  return { out, cursor };
};

test("4 authors: A B C D then wraps to A", () => {
  assert.deepEqual(run(["A", "B", "C", "D"], 6).out, ["A", "B", "C", "D", "A", "B"]);
});

test("2 authors, 4 articles: A B A B; 1 author always the same", () => {
  assert.deepEqual(run(["A", "B"], 4).out, ["A", "B", "A", "B"]);
  assert.deepEqual(run(["Solo"], 3).out, ["Solo", "Solo", "Solo"]);
  assert.deepEqual(takeTurn([], 5), { name: null, cursor: 0 });
});

test("cursor is always read modulo the list (remove while the pointer is past the end)", () => {
  assert.equal(slotFor(7, 3), 1);
  assert.equal(slotFor(-1, 3), 2);
  assert.equal(slotFor(Number.NaN, 3), 0);
  assert.equal(nextUpName(["A", "B"], 5), "B");
  // pointer at D (3), D removed -> wraps to A, never out of range
  assert.equal(cursorAfterEdit(["A", "B", "C", "D"], 3, ["A", "B", "C"]), 0);
  // pointer at C (2), C and D removed -> clamps into the new list
  assert.equal(cursorAfterEdit(["A", "B", "C", "D"], 2, ["A", "B"]), 0);
  assert.equal(cursorAfterEdit(["A", "B", "C"], 1, []), 0);
});

test("reorder keeps the next-up person next up", () => {
  // B is next; move B to the end -> cursor follows B
  assert.equal(cursorAfterEdit(["A", "B", "C", "D"], 1, ["A", "C", "D", "B"]), 3);
  // rename keeps position (old next-up no longer present)
  assert.equal(cursorAfterEdit(["A", "B", "C"], 1, ["A", "Bee", "C"]), 1);
  // adding a name at the end does not disturb the sequence
  assert.equal(cursorAfterEdit(["A", "B"], 1, ["A", "B", "C"]), 1);
  assert.deepEqual(run(["A", "B", "C"], 4, 1).out, ["B", "C", "A", "B"]);
});

test("moveItem for drag and up/down", () => {
  assert.deepEqual(moveItem(["A", "B", "C", "D"], 0, 2), ["B", "C", "A", "D"]);
  assert.deepEqual(moveItem(["A", "B", "C", "D"], 3, 0), ["D", "A", "B", "C"]);
  assert.deepEqual(moveItem(["A", "B"], 0, 9), ["B", "A"]);
  assert.deepEqual(moveItem(["A", "B"], 1, 9), ["A", "B"]);
  assert.deepEqual(moveItem(["A", "B"], 5, 0), ["A", "B"]);
});

test("checkAuthorList: trims, rejects empty, duplicates, bad names, too many", () => {
  assert.deepEqual(checkAuthorList(["  John   Daniel ", "Mia Ross"]), { ok: true, names: ["John Daniel", "Mia Ross"] });
  assert.deepEqual(checkAuthorList([]), { ok: true, names: [] });
  assert.equal(checkAuthorList(["John", "  "]).ok, false);
  const dup = checkAuthorList(["John Daniel", "john daniel"]);
  assert.ok(!dup.ok && /twice/.test(dup.error));
  assert.equal(checkAuthorList(["<b>x</b>"]).ok, false);
  assert.equal(checkAuthorList(["x".repeat(61)]).ok, false);
  assert.equal(checkAuthorList(Array.from({ length: MAX_AUTHORS + 1 }, (_, i) => `Name ${String.fromCharCode(65 + (i % 26))}${"a".repeat(Math.floor(i / 26) + 1)}`)).ok, false);
  assert.equal(checkAuthorList("John").ok, false);
});

function freshDb(file?: string) {
  const db = new DatabaseSync(file ?? ":memory:");
  db.exec(`create table automation_profiles (id text primary key, name text, settings text, author_name text);
           create table site_settings (id text primary key, data text);`);
  return db;
}
const toSqlite = (s: string) => s.replace(/\$(\d+)/g, "?$1");

test("migration 0026 seeds each existing single author as entry #1", () => {
  const db = freshDb();
  db.exec(`insert into automation_profiles values ('p1', 'Gemini', '{}', ' John Daniel '), ('p2', 'Claude', '{}', null), ('p3', 'Grok', '{}', '');
           insert into site_settings values ('automation_default_author', '"Mia Ross"');`);
  db.exec(readFileSync(new URL("../../migrations/d1/0026_author_rotation.sql", import.meta.url), "utf8"));
  const rows = db.prepare("select profile_id, names, next_index from automation_authors order by profile_id").all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { profile_id: "default", names: '["Mia Ross"]', next_index: 0 },
    { profile_id: "p1", names: '["John Daniel"]', next_index: 0 },
  ]);
  // idempotent
  db.exec(readFileSync(new URL("../../migrations/d1/0026_author_rotation.sql", import.meta.url), "utf8"));
  assert.equal((db.prepare("select count(*) c from automation_authors").get() as { c: number }).c, 2);
});

test("TAKE_TURN_SQL: strict round-robin, survives a pointer past the end, empty list = no turn", () => {
  const db = freshDb();
  db.exec(readFileSync(new URL("../../migrations/d1/0026_author_rotation.sql", import.meta.url), "utf8"));
  db.exec(`insert into automation_authors values ('p1', '["A","B","C","D"]', 0, ''), ('p2', '[]', 0, ''), ('p3', '["X","Y"]', 9, '')`);
  const take = (id: string) => nameFromTurnRow(db.prepare(toSqlite(TAKE_TURN_SQL)).get("t", id) as { names: string; next_index: number } | undefined);
  assert.deepEqual([1, 2, 3, 4, 5].map(() => take("p1")), ["A", "B", "C", "D", "A"]);
  assert.equal(take("p2"), null);
  assert.equal(take("nope"), null);
  assert.deepEqual([1, 2, 3].map(() => take("p3")), ["Y", "X", "Y"]); // 9 % 2 = 1 -> Y first
});

test("concurrency: parallel publishes across two connections never share or skip a slot", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "arot-")), "d1.sqlite");
  const a = freshDb(file);
  a.exec("pragma journal_mode = wal");
  a.exec(readFileSync(new URL("../../migrations/d1/0026_author_rotation.sql", import.meta.url), "utf8"));
  a.exec(`insert into automation_authors values ('p1', '["A","B","C","D"]', 0, '')`);
  const b = new DatabaseSync(file);
  b.exec("pragma busy_timeout = 2000");
  const got: string[] = [];
  await Promise.all(Array.from({ length: 100 }, async (_, i) => {
    await new Promise((r) => setTimeout(r, Math.random() * 5));
    const db = i % 2 ? a : b;
    const name = nameFromTurnRow(db.prepare(toSqlite(TAKE_TURN_SQL)).get("t", "p1") as { names: string; next_index: number });
    got.push(name ?? "-");
  }));
  const counts = got.reduce<Record<string, number>>((m, n) => ({ ...m, [n]: (m[n] ?? 0) + 1 }), {});
  assert.deepEqual(counts, { A: 25, B: 25, C: 25, D: 25 });
  // completion order is the assignment order: strictly cyclic
  got.forEach((n, i) => assert.equal(n, "ABCD"[i % 4]));
  assert.equal((a.prepare("select next_index from automation_authors").get() as { next_index: number }).next_index, 0);
});
