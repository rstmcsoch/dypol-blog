#!/usr/bin/env node
/**
 * AI draft editing over MCP: get/list/update/cover/delete with the published
 * lock, per-article admin grant, own-profile rule and audit rows.
 * WRITES to the target database: local `wrangler dev` or isolated preview only.
 *   BASE=http://127.0.0.1:8787 MCP_TOKEN=.. ADMIN_TOKEN=.. \
 *   PROFILE_A_TOKEN=dyp_.. PROFILE_B_TOKEN=dyp_.. CAT=systems OTHER_CAT=design \
 *   npm run test:e2e:ai-edit
 * Never point this at production.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
if (/^https:\/\/(dypolblog|dypol-blog)\.rstmcsoch\.workers\.dev\/?$/.test(BASE)) throw new Error("Refusing production.");
const MASTER = process.env.MCP_TOKEN ?? "";
const ADMIN = process.env.ADMIN_TOKEN ?? "";
const A = process.env.PROFILE_A_TOKEN ?? "", B = process.env.PROFILE_B_TOKEN ?? "";
const CAT = process.env.CAT ?? "systems", OTHER = process.env.OTHER_CAT ?? "design";
assert.ok(MASTER.length >= 16 && ADMIN.length >= 16, "set MCP_TOKEN and ADMIN_TOKEN");
assert.ok(A.startsWith("dyp_") && B.startsWith("dyp_"), "set PROFILE_A_TOKEN and PROFILE_B_TOKEN");
const run = Math.random().toString(16).slice(2, 8);
let failures = 0;
async function check(name, fn) { try { await fn(); console.log(`ok - ${name}`); } catch (e) { failures++; console.log(`not ok - ${name}\n  ${e instanceof Error ? e.message.split("\n")[0] : e}`); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCallAt = 0;
async function pace() {
  // The local MCP limiter counts 30 requests/minute across tokens: pace globally.
  const wait = 2150 - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}
async function call(token, name, args = {}) {
  await pace();
  const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }) });
  const text = await r.text();
  let payload; try { payload = JSON.parse(text); } catch { payload = JSON.parse(text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "{}"); }
  if (payload.error) return { ok: false, error: payload.error.message ?? "rpc error" };
  const parsed = JSON.parse(payload.result.content[0].text);
  return parsed && typeof parsed === "object" && "ok" in parsed ? parsed : { ok: !parsed.error, data: parsed, error: parsed.error };
}
const words = (n, s) => Array.from({ length: n }, (_, i) => `${s}${i % 11}word`).join(" ");
const draftBody = `## Draft section\n\n${words(90, "alpha")}\n\n${words(70, "beta")}`;
const mk = (k, cat, extra = {}) => ({ idempotency_key: `aiedit-${run}-${k}`, title: `AI edit probe ${run} ${k}`, excerpt: "Created by the ai-edit e2e suite to verify draft editing rules.", body: draftBody, category: cat, source_urls: ["https://developers.cloudflare.com/d1/", "https://modelcontextprotocol.io/specification"], ...extra });

let settings, tag1, tag2, dA, dM, pub, mediaId, profileAId;
await check("setup: taxonomy + drafts by profile A and master, one published article", async () => {
  settings = await call(MASTER, "get_blog_settings");
  assert.equal(settings.ok, true, JSON.stringify(settings));
  tag1 = settings.data.tags[0]?.id; tag2 = settings.data.tags[1]?.id;
  assert.ok(tag1 && tag2, "need two tags");
  profileAId = (await call(A, "get_blog_settings")).data.automation.profile.id;
  const ra = await call(A, "submit_article_draft", mk("draft-a", CAT, { uncertain: true, tags: [tag1] }));
  assert.equal(ra.ok, true, JSON.stringify(ra)); assert.equal(ra.data.status, "draft", JSON.stringify(ra.data));
  dA = ra.data.article_id;
  const rm = await call(MASTER, "submit_article_draft", mk("draft-m", CAT, { uncertain: true }));
  assert.equal(rm.ok, true, JSON.stringify(rm)); dM = rm.data.article_id;
  const rp = await call(A, "submit_article_draft", mk("pub", CAT));
  assert.equal(rp.ok, true, JSON.stringify(rp));
  pub = rp.data.article_id;
  if (rp.data.status !== "published") {
    const p = await call(A, "publish_article_if_allowed", { article_id: pub });
    assert.equal(p.data?.published, true, JSON.stringify(p));
  }
});

await check("tools/list exposes the six new editing tools", async () => {
  const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { authorization: `Bearer ${MASTER}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  const payload = await r.json();
  const names = payload.result.tools.map((t) => t.name);
  for (const n of ["get_article", "list_editable_articles", "update_article_draft", "set_article_cover", "remove_article_cover", "delete_article_draft"]) assert.ok(names.includes(n), n);
});

await check("list_editable_articles: own drafts only for a profile, all for master, published excluded", async () => {
  const la = await call(A, "list_editable_articles", { limit: 50 });
  const idsA = la.data.articles.map((x) => x.article_id);
  assert.ok(idsA.includes(dA), "A sees its draft");
  assert.ok(!idsA.includes(dM), "A must not see the master draft");
  assert.ok(!idsA.includes(pub), "published never listed");
  const lm = await call(MASTER, "list_editable_articles", { limit: 50 });
  const idsM = lm.data.articles.map((x) => x.article_id);
  assert.ok(idsM.includes(dA) && idsM.includes(dM), "master sees all drafts");
});

await check("get_article returns full draft; other-profile and owner drafts refused for A", async () => {
  const g = await call(A, "get_article", { article_id: dA });
  assert.equal(g.ok, true, JSON.stringify(g));
  assert.match(g.data.body, /Draft section/);
  assert.deepEqual(g.data.tags.map((t) => t.id), [tag1]);
  assert.ok(g.data.flags.includes("self_reported_uncertain"));
  const cross = await call(B, "get_article", { article_id: dA });
  assert.equal(cross.ok, false); assert.match(cross.error, /different automation profile/);
  const owners = await call(A, "get_article", { article_id: dM });
  assert.equal(owners.ok, false); assert.match(owners.error, /master MCP token|other automations/);
});

await check("update edits every field on own draft; id/status preserved; stays draft", async () => {
  const before = await call(A, "get_article", { article_id: dA });
  const u = await call(A, "update_article_draft", {
    article_id: dA, title: `AI edit probe ${run} draft-a revised`, slug: `aiedit-${run}-revised`,
    excerpt: "Revised excerpt written by the ai-edit e2e suite after editing.",
    body: `## Revised section\n\n${words(120, "gamma")}`, category: OTHER, tags: [tag2],
    seo_title: "Revised SEO title", seo_description: "Revised SEO description.",
    source_urls: ["https://developers.cloudflare.com/d1/"],
  });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(u.data.status, "draft");
  assert.equal(u.data.article_id, dA);
  const after = await call(A, "get_article", { article_id: dA });
  assert.equal(after.data.title, `AI edit probe ${run} draft-a revised`);
  assert.equal(after.data.slug, `aiedit-${run}-revised`);
  assert.equal(after.data.category.id, OTHER);
  assert.deepEqual(after.data.tags.map((t) => t.id), [tag2]);
  assert.equal(after.data.seoTitle, "Revised SEO title");
  assert.deepEqual(after.data.sourceUrls, ["https://developers.cloudflare.com/d1/"]);
  assert.match(after.data.body, /Revised section/);
  assert.equal(after.data.status, before.data.status);
});

await check("tag add/remove without touching the rest", async () => {
  const u = await call(A, "update_article_draft", { article_id: dA, add_tags: [tag1], remove_tags: [tag2] });
  assert.equal(u.ok, true, JSON.stringify(u));
  const g = await call(A, "get_article", { article_id: dA });
  assert.deepEqual(g.data.tags.map((t) => t.id), [tag1]);
});

await check("slug collision with another article is refused", async () => {
  const gm = await call(MASTER, "get_article", { article_id: dM });
  const u = await call(A, "update_article_draft", { article_id: dA, slug: gm.data.slug });
  assert.equal(u.ok, false); assert.match(u.error, /already used/);
});

await check("cross-profile update/delete refused; master may edit any draft", async () => {
  const u = await call(B, "update_article_draft", { article_id: dA, title: "Hijacked title attempt here" });
  assert.equal(u.ok, false); assert.match(u.error, /different automation profile/);
  const d = await call(B, "delete_article_draft", { article_id: dA, confirm: true, slug: `aiedit-${run}-revised` });
  assert.equal(d.ok, false);
  const um = await call(MASTER, "update_article_draft", { article_id: dA, excerpt: "Master token touched this excerpt to prove access." });
  assert.equal(um.ok, true, JSON.stringify(um));
});

await check("cover set/remove on draft; upload path returns a media id", async () => {
  const { createRequire } = await import("node:module");
  const { deflateSync } = createRequire(import.meta.url)("node:zlib");
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(480, 0); ihdr.writeUInt32BE(270, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((480 * 3 + 1) * 270); for (let y = 0; y < 270; y += 1) for (let x = 0; x < 480; x += 1) raw[y * (480 * 3 + 1) + 1 + x * 3] = (x * 255) / 480;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  const up = await call(A, "upload_featured_image", { image_base64: png.toString("base64"), alt: "ai-edit probe gradient" });
  assert.equal(up.ok, true, JSON.stringify(up));
  mediaId = up.data.media_id;
  const set = await call(A, "set_article_cover", { article_id: dA, media_id: mediaId });
  assert.equal(set.ok, true, JSON.stringify(set));
  const g = await call(A, "get_article", { article_id: dA });
  assert.equal(g.data.coverMediaId, mediaId);
  const rm = await call(A, "remove_article_cover", { article_id: dA });
  assert.equal(rm.ok, true, JSON.stringify(rm));
  const g2 = await call(A, "get_article", { article_id: dA });
  assert.equal(g2.data.coverMediaId, null);
  const set2 = await call(A, "set_article_cover", { article_id: dA, media_id: mediaId });
  assert.equal(set2.ok, true, "cover re-set before delete test");
});

await check("published: every AI operation refused without a grant (incl. publish tool)", async () => {
  const ops = [
    ["get_article", { article_id: pub }],
    ["update_article_draft", { article_id: pub, title: "Locked title change attempt" }],
    ["set_article_cover", { article_id: pub, media_id: mediaId ?? "whatever" }],
    ["remove_article_cover", { article_id: pub }],
    ["delete_article_draft", { article_id: pub, confirm: true, slug: "x" }],
  ];
  for (const [name, args] of ops) {
    const r = await call(A, name, args);
    assert.equal(r.ok, false, `${name} should refuse`);
    assert.match(r.error, /published articles are locked|cannot delete a published/, `${name}: ${r.error}`);
  }
  const p = await call(A, "publish_article_if_allowed", { article_id: pub });
  assert.equal(p.data?.published, false, JSON.stringify(p));
});

let browser;
await check("admin grant: AI may edit but not delete/unpublish/slug; revoke locks again", async () => {
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.fill('input[type="password"]', ADMIN);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\/?$/);
  await page.goto(`${BASE}/admin/articles/${pub}`, { waitUntil: "networkidle" });
  const box = page.getByLabel("Allow AI to edit this article");
  await box.check();
  await page.getByText(/AI may now edit this published article/).waitFor({ timeout: 10000 });
  const u = await call(A, "update_article_draft", { article_id: pub, title: `AI edit probe ${run} pub revised`, excerpt: "Grant-edited excerpt on a published article, status must not move." });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(u.data.status, "published");
  const slugTry = await call(A, "update_article_draft", { article_id: pub, slug: `aiedit-${run}-renamed` });
  assert.equal(slugTry.ok, false); assert.match(slugTry.error, /slug of a published article/);
  const del = await call(A, "delete_article_draft", { article_id: pub, confirm: true, slug: "any" });
  assert.equal(del.ok, false); assert.match(del.error, /cannot delete a published article/);
  const pubPage = await fetch(`${BASE}/articles/${(await call(MASTER, "list_recent_articles", { status: "published", limit: 50 })).data.articles.find((x) => x.id === pub).slug}`);
  assert.equal(pubPage.status, 200, "published page still live after grant edits");
  await page.goto(`${BASE}/admin/articles/${pub}`, { waitUntil: "networkidle" });
  await page.getByLabel("Allow AI to edit this article").uncheck();
  await page.getByText(/AI edit grant removed/).waitFor({ timeout: 10000 });
  const locked = await call(A, "update_article_draft", { article_id: pub, title: "Locked again title attempt" });
  assert.equal(locked.ok, false); assert.match(locked.error, /published articles are locked/);
  // list badge visible
  await page.goto(`${BASE}/admin/articles/`, { waitUntil: "networkidle" });
  await page.getByLabel("Allow AI to edit this article").waitFor({ timeout: 5000 }).catch(() => null);
  await page.close();
});

await check("delete draft: slug echo guard, then hard delete; cover file kept", async () => {
  const wrong = await call(A, "delete_article_draft", { article_id: dA, confirm: true, slug: "not-the-slug" });
  assert.equal(wrong.ok, false); assert.match(wrong.error, /does not match/);
  const del = await call(A, "delete_article_draft", { article_id: dA, confirm: true, slug: `aiedit-${run}-revised` });
  assert.equal(del.ok, true, JSON.stringify(del));
  const g = await call(MASTER, "get_article", { article_id: dA });
  assert.equal(g.ok, false); assert.match(g.error, /no longer exists/);
  if (mediaId) {
    const nd = await call(A, "submit_article_draft", mk("draft-a2", CAT, { uncertain: true }));
    const set = await call(A, "set_article_cover", { article_id: nd.data.article_id, media_id: mediaId });
    assert.equal(set.ok, true, "cover media survived the draft delete");
  }
});

await check("explicit publish: flags + wrong category + reached cap do not block; warnings returned; then locked", async () => {
  // Profile A's policy allows CAT only and (from today's earlier suites) its
  // daily cap may be reached; an uncertain draft in OTHER is blocked three ways
  // for AUTOMATIC publishing. Explicit publish must still work, with warnings.
  const r = await call(A, "submit_article_draft", mk("explicit", OTHER, { uncertain: true }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.published, false, "automatic path must stay blocked");
  const crossPub = await call(B, "publish_article_if_allowed", { article_id: r.data.article_id });
  assert.equal(crossPub.ok, false, "cross-profile explicit publish refused");
  const p = await call(A, "publish_article_if_allowed", { article_id: r.data.article_id });
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.equal(p.data.published, true, JSON.stringify(p.data));
  assert.equal(p.data.mode, "explicit");
  const warnings = (p.data.warnings ?? []).join(" ");
  assert.match(warnings, /self_reported_uncertain|allowed list/, warnings);
  // Now published: locked for AI writes, re-publish answers already_published.
  const upd = await call(A, "update_article_draft", { article_id: r.data.article_id, title: "Locked after explicit publish" });
  assert.equal(upd.ok, false); assert.match(upd.error, /published articles are locked/);
  const again = await call(A, "publish_article_if_allowed", { article_id: r.data.article_id });
  assert.equal(again.data.published, false);
  assert.equal(again.data.already_published, true);
  const page = await fetch(`${BASE}/articles/${p.data.path.split("/").pop()}`);
  assert.equal(page.status, 200);
});

await check("explicit publish: master may publish another profile's draft", async () => {
  const r = await call(A, "submit_article_draft", mk("explicit-master", CAT, { uncertain: true }));
  assert.equal(r.data.published, false);
  const p = await call(MASTER, "publish_article_if_allowed", { article_id: r.data.article_id });
  assert.equal(p.data.published, true, JSON.stringify(p.data));
});

await check("audit rows: admin automation page shows the editing runs for profile A", async () => {
  if (!browser) browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.fill('input[type="password"]', ADMIN);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\/?$/);
  await page.goto(`${BASE}/admin/automation?profile=${profileAId}`, { waitUntil: "networkidle" });
  const text = await page.textContent("body");
  assert.match(text, /update_article_draft/);
  assert.match(text, /delete_article_draft/);
  assert.match(text, /published \(explicit\)/);
  await page.close();
});

if (browser) await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall AI edit checks passed");
process.exit(failures ? 1 : 0);
