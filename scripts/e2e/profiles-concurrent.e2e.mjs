#!/usr/bin/env node
/**
 * Two automation profiles at the same time (parallel MCP requests).
 * Proves: separate tokens -> separate settings, drafts, publishing policies,
 * daily limits and run logs; pausing one profile does not affect the other.
 *
 * Profiles/tokens are created by the owner in admin (or seeded in a test DB).
 * This script never creates tokens and never prints them.
 *   BASE=http://127.0.0.1:8787 \
 *   PROFILE_A_TOKEN=dyp_p... PROFILE_B_TOKEN=dyp_p... PROFILE_PAUSED_TOKEN=dyp_p... \
 *   CAT_A=systems CAT_B=design node scripts/e2e/profiles-concurrent.e2e.mjs
 * PROFILE_PAUSED_TOKEN is optional: a profile that is disabled/paused in admin.
 * Never point this at production.
 */
import assert from "node:assert/strict";
const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
if (/^https:\/\/(dypolblog|dypol-blog)\.rstmcsoch\.workers\.dev\/?$/.test(BASE)) throw new Error("Refusing production.");
const A = process.env.PROFILE_A_TOKEN ?? "", B = process.env.PROFILE_B_TOKEN ?? "", PAUSED = process.env.PROFILE_PAUSED_TOKEN ?? "";
const CAT_A = process.env.CAT_A ?? "systems", CAT_B = process.env.CAT_B ?? "design";
assert.ok(A.startsWith("dyp_") && B.startsWith("dyp_"), "set PROFILE_A_TOKEN and PROFILE_B_TOKEN");
const run = Math.random().toString(16).slice(2, 8);
let failures = 0;
async function check(name, fn) { try { await fn(); console.log(`ok - ${name}`); } catch (e) { failures++; console.log(`not ok - ${name}\n  ${e instanceof Error ? e.message.split("\n")[0] : e}`); } }
async function call(token, name, args = {}) {
  const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }) });
  const text = await r.text();
  let payload; try { payload = JSON.parse(text); } catch { payload = JSON.parse(text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "{}"); }
  const content = payload.result?.content?.[0]?.text;
  if (!content) return payload;
  const parsed = JSON.parse(content);
  // Tools return { ok, data } or { ok, error }; normalise to that shape.
  return parsed && typeof parsed === "object" && "ok" in parsed ? parsed : { ok: !parsed.error, data: parsed, error: parsed.error };
}
const words = (n, s) => Array.from({ length: n }, (_, i) => `${s}${i % 13}word`).join(" ");
const article = (k, cat) => ({ idempotency_key: `profiles-${run}-${k}`, title: `Concurrent profiles probe ${run} ${k}`, excerpt: "Submitted by the two-profile concurrency test to verify isolation.", body: `## Why\n\n${words(90, "alpha")}\n\n${words(70, "beta")}`, category: cat, tags: [], source_urls: ["https://developers.cloudflare.com/d1/", "https://modelcontextprotocol.io/specification"] });

let a1, b1;
await check("settings isolation: each token sees its own profile and policy", async () => {
  const [sa, sb] = await Promise.all([call(A, "get_blog_settings"), call(B, "get_blog_settings")]);
  assert.notEqual(sa.data.automation.profile.id, sb.data.automation.profile.id);
  assert.ok(sa.data.automation.publishingPolicy.allowedCategoryIds.includes(CAT_A));
  assert.ok(sb.data.automation.publishingPolicy.allowedCategoryIds.includes(CAT_B));
});
await check("parallel submits: two profiles create separate drafts at the same time", async () => {
  const [ra, rb] = await Promise.all([call(A, "submit_article_draft", article("a1", CAT_A)), call(B, "submit_article_draft", article("b1", CAT_B))]);
  assert.equal(ra.ok, true, JSON.stringify(ra)); assert.equal(rb.ok, true, JSON.stringify(rb));
  a1 = ra.data.article_id; b1 = rb.data.article_id; assert.ok(a1 && b1 && a1 !== b1);
});
await check("daily limit is per-profile: A publishes, B still can in its own category", async () => {
  const [pa, pb] = await Promise.all([call(A, "publish_article_if_allowed", { article_id: a1 }), call(B, "publish_article_if_allowed", { article_id: b1 })]);
  assert.equal(pa.data?.published ?? pa.ok, true, JSON.stringify(pa));
  // B publishing proves A's daily count did not consume B's limit.
  assert.equal(pb.data?.published ?? pb.ok, true, JSON.stringify(pb));
});
await check("cross-profile publish is refused", async () => {
  const ra2 = await call(A, "submit_article_draft", article("a2", CAT_A));
  const cross = await call(B, "publish_article_if_allowed", { article_id: ra2.data.article_id });
  assert.equal(cross.ok, false); assert.match(cross.error ?? "", /different automation profile/);
});
if (PAUSED) await check("paused/disabled profile is refused while others keep working", async () => {
  const refused = await call(PAUSED, "submit_article_draft", article("p1", CAT_A));
  assert.equal(refused.ok, false);
  const still = await call(A, "submit_article_draft", article("a3", CAT_A));
  assert.equal(still.ok, true, JSON.stringify(still));
});
console.log(failures ? `\n${failures} check(s) failed` : "\nall profile concurrency checks passed");
process.exit(failures ? 1 : 0);
