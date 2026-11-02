/** t177: the website daily cap is ONE global cap across Normal + Special AI publishes. */
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { atomicClaimStatement, capWindowStart, combinedLimitVerdict, limitVerdict, type ArticleKind } from "./publish-limits.ts";

function db() {
  const d = new DatabaseSync(":memory:");
  d.exec(`create table articles (id text primary key, status text not null default 'draft', article_type text not null default 'regular');
    create table automation_runs (id text primary key, created_at text, tool text, outcome text, reason text, article_id text, auth text, details text, profile_id text)`);
  return d;
}
const q = (text: string) => text.replace(/\$(\d+)/g, "?$1");
let n = 0;

type Caps = { websiteCap: number; normalRunCap: number; specialCap: number };
/** Mirrors tools.server claimPublish: stale-able pre-check, then the atomic claim, then the flip. */
function counts(d: DatabaseSync, since: string) {
  const all = Number((d.prepare(`select count(*) n from automation_runs where tool='publish_article_if_allowed' and outcome in ('published','published_explicit','publish_claim') and created_at >= ?`).get(since) as { n: number }).n);
  const sp = Number((d.prepare(`select count(*) n from automation_runs r join articles a on a.id = r.article_id where r.tool='publish_article_if_allowed' and r.outcome in ('published','published_explicit','publish_claim') and a.article_type='special' and r.created_at >= ?`).get(since) as { n: number }).n);
  return { all, sp };
}
function precheck(d: DatabaseSync, kind: ArticleKind, caps: Caps, runUsed: number) {
  const since = capWindowStart();
  const c = counts(d, since);
  return combinedLimitVerdict({ kind, websiteUsed: c.all, websiteCap: caps.websiteCap, runUsed, runCap: kind === "regular" ? caps.normalRunCap : 0, specialUsed: c.sp, specialCap: caps.specialCap });
}
function claim(d: DatabaseSync, kind: ArticleKind, articleId: string, caps: Caps, profileId = "default"): boolean {
  const stmt = atomicClaimStatement({ id: `c${++n}`, createdAt: new Date().toISOString(), profileId, articleId, auth: "test", details: "{}", since: capWindowStart(), websiteCap: caps.websiteCap, specialCap: kind === "special" ? caps.specialCap : 0 });
  const row = d.prepare(q(stmt.text)).get(...(stmt.params as never[]));
  if (!row) return false;
  d.prepare("update automation_runs set outcome='published' where id=?").run((row as { id: string }).id);
  d.prepare("update articles set status='published' where id=?").run(articleId);
  return true;
}
function draft(d: DatabaseSync, kind: ArticleKind) {
  const id = `a${++n}`;
  d.prepare("insert into articles (id, article_type) values (?, ?)").run(id, kind);
  return id;
}
/** Sequential publishing; returns per-article outcome + reason. */
function publishAll(d: DatabaseSync, order: ArticleKind[], caps: Caps) {
  let normalRun = 0;
  return order.map((kind) => {
    const id = draft(d, kind);
    const v = precheck(d, kind, caps, kind === "regular" ? normalRun : 0);
    if (v.blocked) return { kind, id, published: false, reason: v.websiteReason ?? v.specialReason ?? v.runReason };
    const ok = claim(d, kind, id, caps);
    if (ok && kind === "regular") normalRun++;
    return { kind, id, published: ok, reason: ok ? null : "Publish limit reached." };
  });
}

test("10/15/15: main 10/day, Normal 15, Special 15 → exactly 10 public articles, the rest stay drafts with a reason", () => {
  const d = db();
  const caps = { websiteCap: 10, normalRunCap: 15, specialCap: 15 };
  const order: ArticleKind[] = Array.from({ length: 30 }, (_, i) => (i % 2 ? "special" : "regular"));
  const out = publishAll(d, order, caps);
  assert.equal(out.filter((o) => o.published).length, 10);
  assert.equal(out.filter((o) => o.published && o.kind === "regular").length, 5);
  assert.equal(out.filter((o) => o.published && o.kind === "special").length, 5);
  for (const o of out.slice(10)) {
    assert.equal(o.published, false);
    assert.match(o.reason ?? "", /Website daily publish limit reached \(10\)/);
  }
  // Held, not lost: 20 drafts still exist.
  assert.equal(Number((d.prepare("select count(*) n from articles where status='draft'").get() as { n: number }).n), 20);
  assert.equal(counts(d, capWindowStart()).all, 10);
});

test("mixed ordering: whichever type comes first takes the slots; the total never exceeds the main limit", () => {
  const caps = { websiteCap: 10, normalRunCap: 15, specialCap: 15 };
  const specialsFirst = publishAll(db(), [...Array(12).fill("special"), ...Array(12).fill("regular")] as ArticleKind[], caps);
  assert.equal(specialsFirst.filter((o) => o.published && o.kind === "special").length, 10);
  assert.equal(specialsFirst.filter((o) => o.published && o.kind === "regular").length, 0);
  const normalsFirst = publishAll(db(), [...Array(12).fill("regular"), ...Array(12).fill("special")] as ArticleKind[], caps);
  assert.equal(normalsFirst.filter((o) => o.published && o.kind === "regular").length, 10);
  assert.equal(normalsFirst.filter((o) => o.published && o.kind === "special").length, 0);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let trial = 0; trial < 20; trial++) {
    const order = Array.from({ length: 40 }, () => (rnd() < 0.5 ? "regular" : "special")) as ArticleKind[];
    assert.equal(publishAll(db(), order, caps).filter((o) => o.published).length, 10);
  }
});

test("a tab limit below the main limit binds first, and the main limit still caps the total", () => {
  const out = publishAll(db(), [...Array(6).fill("special"), ...Array(12).fill("regular")] as ArticleKind[], { websiteCap: 10, normalRunCap: 15, specialCap: 3 });
  assert.equal(out.filter((o) => o.published && o.kind === "special").length, 3);
  assert.match(out[3].reason ?? "", /Special-article daily publish limit reached \(3\)/);
  assert.equal(out.filter((o) => o.published && o.kind === "regular").length, 7);
  assert.equal(out.filter((o) => o.published).length, 10);
  const normalRun = publishAll(db(), Array(8).fill("regular") as ArticleKind[], { websiteCap: 10, normalRunCap: 4, specialCap: 15 });
  assert.equal(normalRun.filter((o) => o.published).length, 4);
  assert.match(normalRun[4].reason ?? "", /Per-run publish limit reached \(4\)/);
});

test("concurrency: 40 publishers from different profiles/types that all passed a stale pre-check still get only 10 slots", async () => {
  const d = db();
  const caps = { websiteCap: 10, normalRunCap: 15, specialCap: 15 };
  const jobs = Array.from({ length: 40 }, (_, i) => ({ kind: (i % 3 ? "special" : "regular") as ArticleKind, profile: `p${i % 5}`, id: draft(d, i % 3 ? "special" : "regular") }));
  // Every pre-check runs before any claim: all of them see 0 used and pass.
  assert.ok(jobs.every((j) => !precheck(d, j.kind, caps, 0).blocked));
  const results = await Promise.all(jobs.map(async (j) => { await new Promise((r) => setTimeout(r, Math.random() * 5)); return claim(d, j.kind, j.id, caps, j.profile); }));
  assert.equal(results.filter(Boolean).length, 10);
  assert.equal(counts(d, capWindowStart()).all, 10);
  assert.equal(Number((d.prepare("select count(*) n from articles where status='published'").get() as { n: number }).n), 10);
  // Special cap under concurrency too.
  const d2 = db();
  const sp = Array.from({ length: 20 }, () => draft(d2, "special"));
  const r2 = await Promise.all(sp.map(async (id) => claim(d2, "special", id, { websiteCap: 10, normalRunCap: 15, specialCap: 4 })));
  assert.equal(r2.filter(Boolean).length, 4);
});

test("claims older than the UTC day do not count (same window as before)", () => {
  const d = db();
  const old = new Date(Date.parse(capWindowStart()) - 60_000).toISOString();
  for (let i = 0; i < 10; i++) d.prepare("insert into automation_runs values (?, ?, 'publish_article_if_allowed', 'published', '', ?, 'x', '{}', 'default')").run(`o${i}`, old, `x${i}`);
  assert.equal(claim(d, "regular", draft(d, "regular"), { websiteCap: 10, normalRunCap: 0, specialCap: 0 }), true);
});

test("normal-only behaviour is identical to the pre-t177 verdict", () => {
  for (const websiteUsed of [0, 1, 4, 5, 9]) for (const websiteCap of [0, 1, 5]) for (const runUsed of [0, 2, 3]) for (const runCap of [0, 1, 3]) {
    const before = limitVerdict({ websiteUsed, websiteCap, runUsed, runCap });
    const after = combinedLimitVerdict({ kind: "regular", websiteUsed, websiteCap, runUsed, runCap, specialUsed: 99, specialCap: 1 });
    assert.deepEqual(after, { ...before, specialReason: null });
  }
  // No caps → plain insert, exactly as the old claim.
  const stmt = atomicClaimStatement({ id: "i", createdAt: "t", profileId: "p", articleId: "a", auth: "x", details: "{}", since: "s", websiteCap: 0, specialCap: 0 });
  assert.ok(!/where/i.test(stmt.text));
  // Regular articles never see the special cap.
  const d = db();
  const out = publishAll(d, Array(12).fill("regular") as ArticleKind[], { websiteCap: 0, normalRunCap: 15, specialCap: 1 });
  assert.equal(out.filter((o) => o.published).length, 12);
});
