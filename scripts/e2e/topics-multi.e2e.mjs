#!/usr/bin/env node
/**
 * Canonical topics + multi-topic filing over MCP (t44). Verifies migration
 * 0007's legacy mapping, the 25-topic list in get_blog_settings, multi-topic
 * submit (labels + slugs), unknown-topic rejection with the valid list,
 * legacy `category` merging, add/remove topics on update, and that a
 * published multi-topic article appears on every topic page.
 * LOCAL ONLY: seeds a probe row and applies the migration to the local D1.
 *   BASE=http://127.0.0.1:8787 MCP_TOKEN=.. npm run test:e2e:multi-topics
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const MASTER = process.env.MCP_TOKEN ?? "";
assert.ok(MASTER.length >= 16, "set MCP_TOKEN");
const host = new URL(BASE).host;
if (/dypolblog\.rstmcsoch\.workers\.dev$/.test(host) && !host.includes("-dypolblog")) throw new Error("Refusing production.");
assert.ok(/^(127\.0\.0\.1|localhost)/.test(host), "local only");

const sql = (command) => execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--command", command, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const query = (command) => JSON.parse(sql(command))[0].results;

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); }
  catch (e) { failures++; console.log(`not ok - ${name}\n  ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCallAt = 0;
async function call(name, args = {}) {
  const wait = 2150 - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
  const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { authorization: `Bearer ${MASTER}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }) });
  const text = await r.text();
  let payload; try { payload = JSON.parse(text); } catch { payload = JSON.parse(text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "{}"); }
  if (payload.error) return { ok: false, error: payload.error.message ?? "rpc error" };
  const parsed = JSON.parse(payload.result.content[0].text);
  return parsed && typeof parsed === "object" && "ok" in parsed ? parsed : { ok: !parsed.error, data: parsed, error: parsed.error };
}

const run = Math.random().toString(16).slice(2, 8);
const words = (n, s) => Array.from({ length: n }, (_, i) => `${s}${i % 11}word`).join(" ");
const body = `## Section\n\n${words(90, "alpha")}\n\n${words(70, "beta")}`;
const mk = (k, extra = {}) => ({
  idempotency_key: `t44-${run}-${k}`,
  title: `T44 probe ${run} ${k}`,
  excerpt: "Created by the multi-topic e2e suite to verify topic filing.",
  body,
  source_urls: ["https://developers.cloudflare.com/d1/", "https://modelcontextprotocol.io/specification"],
  uncertain: true,
  ...extra,
});

// 1) Seed a legacy-category article, then apply migration 0007 and check the mapping.
const nowIso = new Date().toISOString();
sql(`INSERT OR IGNORE INTO categories (id, slug, label, description) VALUES ('systems', 'systems', 'Systems', '');
DELETE FROM articles WHERE id = 't44-legacy-probe';
INSERT INTO articles (id, slug, title, excerpt, status, published_at, updated_at, category_id, motif, featured, blocks)
VALUES ('t44-legacy-probe', 't44-legacy-probe', 'T44 legacy probe', '', 'draft', NULL, '${nowIso}', 'systems', 'corner', 0, '[]');`);
// Execute the migration file directly (not `migrations apply`, which is a
// no-op once recorded) so the suite is re-runnable: the file is idempotent.
execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--file", "migrations/d1/0007_canonical_topics.sql"], { stdio: "inherit" });

await check("migration: exactly the 25 canonical topics remain; legacy 'systems' article mapped to Developer Tools", async () => {
  const cats = query("SELECT slug FROM categories ORDER BY slug").map((r) => r.slug);
  assert.equal(cats.length, 25, cats.join(","));
  for (const gone of ["systems", "design", "publishing", "notes"]) assert.ok(!cats.includes(gone), gone);
  const probe = query("SELECT category_id FROM articles WHERE id = 't44-legacy-probe'")[0];
  assert.equal(probe.category_id, "developer-tools");
  const links = query("SELECT category_id FROM article_topics WHERE article_id = 't44-legacy-probe'").map((r) => r.category_id);
  assert.deepEqual(links, ["developer-tools"]);
  const tags = query("SELECT id FROM tags WHERE id IN ('structure','type','layout','media','workflow','index')");
  assert.equal(tags.length, 0, "default tags removed");
});

let settings, multiId, multiSlug;
await check("get_blog_settings returns the 25 canonical topics + filing instructions", async () => {
  settings = await call("get_blog_settings");
  assert.equal(settings.ok, true, JSON.stringify(settings));
  assert.equal(settings.data.topics.length, 25);
  assert.ok(settings.data.topics.some((t) => t.slug === "tech-news" && t.label === "Tech News"));
  assert.match(settings.data.topicInstructions, /topics/);
});

await check("submit with mixed label/slug topics files under all three, first is main", async () => {
  const r = await call("submit_article_draft", mk("multi", { topics: ["Product Reviews", "smartphones-android-iphone-wearables", "Buying Guides"] }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.topics, ["product-reviews", "smartphones-android-iphone-wearables", "buying-guides"]);
  multiId = r.data.article_id; multiSlug = r.data.slug;
  const full = await call("get_article", { article_id: multiId });
  assert.deepEqual(full.data.topics.map((t) => t.slug), ["product-reviews", "smartphones-android-iphone-wearables", "buying-guides"]);
  assert.equal(full.data.category.slug, "product-reviews");
});

await check("unknown topic is rejected and the error lists the valid topics", async () => {
  const r = await call("submit_article_draft", mk("bad", { topics: ["Cooking"] }));
  assert.equal(r.ok, false);
  assert.match(r.error, /Unknown topic/);
  assert.match(r.error, /tech-news/);
});

await check("legacy single category still works and lands in topics", async () => {
  const r = await call("submit_article_draft", mk("legacy", { category: "Leaks" }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.topics, ["leaks"]);
});

await check("topics + legacy category merge (topics first, no duplicates)", async () => {
  const r = await call("submit_article_draft", mk("merged", { topics: ["Tech News"], category: "Leaks" }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.topics, ["tech-news", "leaks"]);
});

await check("update: add_topics / remove_topics / unknown rejection", async () => {
  const add = await call("update_article_draft", { article_id: multiId, add_topics: ["Online Scams"] });
  assert.equal(add.ok, true, JSON.stringify(add));
  assert.deepEqual(add.data.topics, ["product-reviews", "smartphones-android-iphone-wearables", "buying-guides", "online-scams"]);
  const remove = await call("update_article_draft", { article_id: multiId, remove_topics: ["buying-guides"] });
  assert.deepEqual(remove.data.topics, ["product-reviews", "smartphones-android-iphone-wearables", "online-scams"]);
  const bad = await call("update_article_draft", { article_id: multiId, add_topics: ["Astrology"] });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /tech-news/);
});

const browser = await chromium.launch();
try {
  await check("published multi-topic article appears on every topic page and shows all topics", async () => {
    const pub = await call("publish_article_if_allowed", { article_id: multiId });
    assert.equal(pub.ok, true, JSON.stringify(pub));
    assert.equal(pub.data.published, true);
    const page = await (await browser.newContext()).newPage();
    for (const slug of ["product-reviews", "smartphones-android-iphone-wearables", "online-scams"]) {
      const res = await page.goto(`${BASE}/topics/${slug}`);
      assert.equal(res.status(), 200, slug);
      assert.ok((await page.textContent("main")).includes(`T44 probe ${run} multi`), `${slug} lists the article`);
    }
    const topicsPage = await page.goto(`${BASE}/topics`);
    assert.equal(topicsPage.status(), 200);
    const main = await page.textContent("main");
    for (const label of ["Artificial Intelligence & AI Tools", "Electric Vehicles", "Leaks", "Tech News"]) assert.ok(main.includes(label), label);
    const article = await page.goto(`${BASE}/articles/${multiSlug}`);
    assert.equal(article.status(), 200);
    const text = await page.textContent("main");
    assert.ok(text.includes("Product Reviews") && text.includes("Online Scams"), "article header shows multiple topics");
  });
} finally {
  await browser.close();
  // Local cleanup: remove everything this suite created.
  try {
    sql(`DELETE FROM article_topics WHERE article_id IN (SELECT id FROM articles WHERE slug LIKE 't44-%');
         DELETE FROM articles WHERE slug LIKE 't44-%' OR id = 't44-legacy-probe';`);
  } catch { /* best effort */ }
}
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
