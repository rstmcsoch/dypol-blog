#!/usr/bin/env node
/**
 * Special-articles + combined publish cap E2E against a LOCAL dev server
 * (raw Streamable-HTTP JSON-RPC, stateless). It reconfigures the LOCAL D1
 * file directly (automation policy, special settings, website daily cap),
 * runs the checks, then restores the original settings rows.
 *
 *   BASE=http://localhost:8173 MCP_TOKEN=... LOCAL_D1=<.wrangler/.../x.sqlite> \
 *   LOCAL_R2=<.wrangler/.../r2.sqlite> node scripts/e2e/special-mcp.e2e.mjs
 *
 * Refuses anything that is not localhost. Never prints the token.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const BASE = process.env.BASE ?? "http://localhost:8173";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("Local only.");
const TOKEN = process.env.MCP_TOKEN ?? "";
const db = new DatabaseSync(process.env.LOCAL_D1);
const r2 = new DatabaseSync(process.env.LOCAL_R2, { readOnly: true });
const AI = "artificial-intelligence-ai-tools";
const OTHER = "electric-vehicles";
const run = randomBytes(3).toString("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pace = () => sleep(Number(process.env.PACE_MS ?? 2100));

const original = db.prepare("select id, data from site_settings where id in ('site','automation','special_automation')").all();
const bump = () => db.prepare("update content_version set v = v + 1 where id = 1").run();
const getRow = (id) => { const r = db.prepare("select data from site_settings where id = ?").get(id); return r ? JSON.parse(r.data) : {}; };
const putRow = (id, data) => { db.prepare("insert into site_settings (id, data) values (?, ?) on conflict (id) do update set data = excluded.data").run(id, JSON.stringify(data)); bump(); };
const setSiteCap = (n) => putRow("site", { ...getRow("site"), aiDailyPublishLimit: n });
const setSpecial = (over) => putRow("special_automation", { ...getRow("special_automation"), ...over });
function restore() {
  const ids = original.map((r) => r.id);
  for (const r of original) db.prepare("insert into site_settings (id, data) values (?, ?) on conflict (id) do update set data = excluded.data").run(r.id, r.data);
  for (const id of ["automation", "special_automation"]) if (!ids.includes(id)) db.prepare("delete from site_settings where id = ?").run(id);
  bump();
}
const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
const usedToday = () => db.prepare("select count(*) n from automation_runs where tool = 'publish_article_if_allowed' and outcome in ('published','published_explicit','publish_claim') and created_at >= ?").get(dayStart.toISOString()).n;

let id = 0;
async function rpc(method, params) {
  await pace();
  const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const text = await r.text();
  const json = JSON.parse(text.startsWith("event:") || text.startsWith("data:") ? text.split("\n").find((l) => l.startsWith("data:")).slice(5) : text);
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result;
}
async function call(name, args, { nopace } = {}) {
  const res = await rpc("tools/call", { name, arguments: args });
  return { isError: Boolean(res.isError), data: res.structuredContent ?? JSON.parse(res.content[0].text) };
}
let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); } catch (e) { failures += 1; console.log(`not ok - ${name}\n  ${e instanceof Error ? e.message : e}`); }
}
const uniq = () => Array.from({ length: 5 }, () => randomBytes(3).toString("hex")).join(" ");
const srcs = (k) => [1, 2].map((i) => `https://example.org/e2e/${run}/${k}/${i}`);
const words = (n, seed) => Array.from({ length: n }, (_, i) => `${seed}${i % 23}w`).join(" ");
const normal = (k, over = {}) => ({ idempotency_key: `sp-e2e-${run}-${k}`, title: `Normal probe ${uniq()}`, excerpt: "A normal article submitted by the special e2e suite to check compatibility.", body: `## Why\n\n${words(90, k + "a")}\n\n${words(80, k + "b")}`, category: AI, tags: [], source_urls: srcs(k), ...over });
const special = (k, over = {}) => ({ article_type: "special", idempotency_key: `sp-e2e-${run}-${k}`, title: `Special probe ${uniq()}`, excerpt: "A long-form special report submitted by the e2e suite, with sections and sources.", body: `# Background\n\n${words(180, k + "c")}\n\n# Findings\n\n${words(180, k + "d")}\n\n# Outlook\n\n${words(80, k + "e")}`, topics: [AI], sources: srcs(k).map((url, i) => ({ title: `Reference ${i + 1} for ${k}`, url })), ...over });
const r2Keys = (articleId) => r2.prepare("select key from _mf_objects where key like ?").all(`special-articles/${articleId}/%`).map((r) => r.key);
const typeOf = (articleId) => db.prepare("select article_type t, status s, slug from articles where id = ?").get(articleId);
const lastRun = (articleId) => db.prepare("select outcome, reason from automation_runs where article_id = ? and tool = 'publish_article_if_allowed' order by created_at desc, rowid desc limit 1").get(articleId);

try {
  putRow("automation", { ...getRow("automation"), enabled: true, paused: false, mode: "mcp-connector", policy: { ...(getRow("automation").policy ?? {}), autoPublish: true, allowedCategoryIds: [AI], minWords: 120, requireSources: true, minSources: 2, requireFeaturedImage: false, maxPublishedPerRun: 0 } });
  setSpecial({ enabled: true, profileIds: [], eligibleCategoryIds: [AI], minWords: 300, targetWords: 600, maxPerWeek: 0, maxPublishedPerDay: 0, sources: { minSources: 2, minAcademic: 0, requireVerification: false }, seo: { requireFeaturedImage: false, requireAltText: true, minSections: 2, maxTitleChars: 65, minDescriptionChars: 20 }, publishBehaviour: "auto-if-passes" });
  setSiteCap(0);

  await check("special on: submit schema gains article_type; research tools listed", async () => {
    const { tools } = await rpc("tools/list", {});
    const submit = tools.find((t) => t.name === "submit_article_draft");
    assert.ok(submit.inputSchema.properties.article_type, "article_type in schema");
    for (const n of ["web_search", "academic_search", "fact_check_claims", "special_quality_report"]) assert.ok(tools.some((t) => t.name === n), n);
  });

  let legacy;
  await check("legacy submit (no article_type) -> normal article in D1 only, auto-published as before", async () => {
    const { isError, data } = await call("submit_article_draft", normal("legacy"));
    assert.equal(isError, false, JSON.stringify(data));
    assert.equal(data.status, "published", JSON.stringify(data));
    assert.equal(data.article_type, undefined, "legacy response unchanged (no article_type field)");
    assert.equal(typeOf(data.article_id).t, "regular");
    assert.deepEqual(r2Keys(data.article_id), []);
    legacy = data;
  });

  await check("article_type 'regular' behaves exactly like legacy", async () => {
    const { data } = await call("submit_article_draft", { ...normal("regular"), article_type: "regular" });
    assert.equal(data.status, "published", JSON.stringify(data));
    assert.equal(typeOf(data.article_id).t, "regular");
  });

  let sp;
  await check("special submit -> body JSON in R2 (v1), metadata in D1 (article_type=special), auto-published when report passes", async () => {
    const { isError, data } = await call("submit_article_draft", special("one", { slug: `sp-e2e-${run}` }));
    assert.equal(isError, false, JSON.stringify(data));
    assert.equal(data.article_type, "special");
    assert.equal(data.version, 1);
    assert.equal(data.published, true, JSON.stringify(data));
    const row = typeOf(data.article_id);
    assert.equal(row.t, "special"); assert.equal(row.s, "published");
    assert.ok(r2Keys(data.article_id).includes(`special-articles/${data.article_id}/body/v1.json`), r2Keys(data.article_id).join(","));
    const view = await call("get_article", { article_id: data.article_id });
    assert.match(JSON.stringify(view.data), /published articles are locked for AI editing/, "existing lock rule applies to specials too");
    const page = await fetch(`${BASE}/special/${data.slug}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Findings/);
    sp = data;
  });

  await check("slug collision -> unique slug, original untouched", async () => {
    const { data } = await call("submit_article_draft", special("two", { slug: `sp-e2e-${run}` }));
    assert.equal(data.article_type, "special", JSON.stringify(data));
    assert.notEqual(data.slug, sp.slug);
    assert.ok(data.slug.startsWith(`sp-e2e-${run}`));
    assert.equal(typeOf(sp.article_id).slug, sp.slug);
  });

  await check("category gate: non-approved topic refused, nothing written", async () => {
    const before = db.prepare("select count(*) n from articles").get().n;
    const { isError, data } = await call("submit_article_draft", special("gate", { topics: [OTHER] }));
    assert.equal(isError, true);
    assert.match(data.error ?? JSON.stringify(data), /only allowed in owner-approved categories/);
    assert.equal(db.prepare("select count(*) n from articles").get().n, before);
  });

  await check("t177: website cap counts Normal + Special combined; overflow held as DRAFT with reason", async () => {
    const used = usedToday();
    setSiteCap(used + 1);
    const a = await call("submit_article_draft", normal("cap1"));
    assert.equal(a.data.status, "published", JSON.stringify(a.data));
    const b = await call("submit_article_draft", special("cap2"));
    assert.equal(b.data.published, false, JSON.stringify(b.data));
    assert.match(b.data.publish_reasons.join(" "), /Website daily publish limit reached \(\d+\).*Normal \+ Special/);
    assert.equal(typeOf(b.data.article_id).s, "draft");
    const view = await call("get_article", { article_id: b.data.article_id });
    assert.equal(view.data.article_type, "special");
    assert.match(view.data.body, /# Findings/);
    assert.equal(view.data.version, 1);
    const c = await call("submit_article_draft", normal("cap3"));
    assert.equal(c.data.status, "draft", JSON.stringify(c.data));
    const log = lastRun(b.data.article_id);
    assert.equal(log.outcome, "kept_draft");
    assert.match(log.reason, /Website daily publish limit/);
    const p = await call("publish_article_if_allowed", { article_id: b.data.article_id });
    assert.notEqual(p.data.published, true, JSON.stringify(p.data));
    assert.match(JSON.stringify(p.data), /Website daily publish limit/);
    assert.equal(typeOf(b.data.article_id).s, "draft");
    assert.equal(usedToday(), used + 1);
  });

  await check("t177: Special tab per-day cap holds specials; normals unaffected", async () => {
    setSiteCap(0);
    const specialsToday = db.prepare("select count(*) n from automation_runs r join articles a on a.id = r.article_id where a.article_type = 'special' and r.tool = 'publish_article_if_allowed' and r.outcome in ('published','published_explicit','publish_claim') and r.created_at >= ?").get(dayStart.toISOString()).n;
    setSpecial({ maxPublishedPerDay: Math.max(1, specialsToday) });
    const s = await call("submit_article_draft", special("spcap"));
    assert.equal(s.data.published, false, JSON.stringify(s.data));
    assert.match(s.data.publish_reasons.join(" "), /Special-article daily publish limit reached/);
    const n = await call("submit_article_draft", normal("spcap-n"));
    assert.equal(n.data.status, "published", JSON.stringify(n.data));
    setSpecial({ maxPublishedPerDay: 0 });
  });

  await check("t177 concurrency: 6 parallel submits against 2 remaining slots -> exactly 2 published", async () => {
    const used = usedToday();
    setSiteCap(used + 2);
    await pace();
    const res = await Promise.all(Array.from({ length: 6 }, (_, i) => fetch(`${BASE}/mcp`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 900 + i, method: "tools/call", params: { name: "submit_article_draft", arguments: normal(`par${i}`) } }) }).then((r) => r.json())));
    const statuses = res.map((j) => (j.result.structuredContent ?? JSON.parse(j.result.content[0].text)).status);
    assert.equal(statuses.filter((s) => s === "published").length, 2, statuses.join(","));
    assert.equal(usedToday(), used + 2);
    setSiteCap(0);
  });

  await check("special off: special submit refused with a clear message; legacy still works", async () => {
    setSpecial({ enabled: false });
    const { tools } = await rpc("tools/list", {});
    assert.ok(!tools.some((t) => t.name === "web_search"));
    assert.equal(tools.find((t) => t.name === "submit_article_draft").inputSchema.properties.article_type, undefined);
    const s = await call("submit_article_draft", special("off"));
    assert.equal(s.isError, true);
    assert.match(s.data.error, /not enabled/);
    const n = await call("submit_article_draft", normal("off-n"));
    assert.equal(n.data.status, "published", JSON.stringify(n.data));
  });
} finally {
  restore();
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
