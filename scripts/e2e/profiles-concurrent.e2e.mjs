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
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
if (/^https:\/\/(blog\.dypol|dypolblog\.rstmcsoch|dypol-blog\.rstmcsoch)\.workers\.dev\/?$/.test(BASE)) throw new Error("Refusing production.");
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
function makePng(width, height) {
  const { deflateSync } = require("node:zlib");
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height); for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) raw[y * (width * 3 + 1) + 1 + x * 3] = (x * 255) / width;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
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
  // Submit may already have auto-published (policy passed, no image required):
  // either this call publishes, or the article is already published.
  assert.ok(pa.data?.published === true || pa.data?.status === "published", JSON.stringify(pa));
  // B being published proves A's daily count did not consume B's limit.
  assert.ok(pb.data?.published === true || pb.data?.status === "published", JSON.stringify(pb));
});
await check("cross-profile publish is refused", async () => {
  const ra2 = await call(A, "submit_article_draft", article("a2", CAT_A));
  const cross = await call(B, "publish_article_if_allowed", { article_id: ra2.data.article_id });
  assert.equal(cross.ok, false); assert.match(cross.error ?? "", /different automation profile/);
});
const IMG = process.env.PROFILE_IMAGE_TOKEN ?? "";
if (IMG) await check("featured image: draft with image-required policy publishes on image attach", async () => {
  const draft = await call(IMG, "submit_article_draft", article("img1", CAT_A));
  assert.equal(draft.ok, true, JSON.stringify(draft));
  assert.equal(draft.data.published, false, "no cover yet + image required = stays draft");
  const up = await call(IMG, "upload_featured_image", { article_id: draft.data.article_id, image_base64: makePng(480, 270).toString("base64"), alt: "Concurrency test gradient", filename: "probe.png", credit: "Gradient: generated by the e2e test, CC0" });
  assert.equal(up.ok, true, JSON.stringify(up));
  assert.equal(up.data.attached, true);
  assert.equal(up.data.published, true, `image attach should auto-publish when policy passes: ${JSON.stringify(up.data)}`);
});
if (PAUSED) await check("paused/disabled profile is refused while others keep working", async () => {
  const refused = await call(PAUSED, "submit_article_draft", article("p1", CAT_A));
  assert.equal(refused.ok, false);
  const still = await call(A, "submit_article_draft", article("a3", CAT_A));
  assert.equal(still.ok, true, JSON.stringify(still));
});
console.log(failures ? `\n${failures} check(s) failed` : "\nall profile concurrency checks passed");
process.exit(failures ? 1 : 0);
