#!/usr/bin/env node
/**
 * Topic selection modes e2e (local/preview DB only, never production).
 * Seed profiles first (settings.topicSelection + topicIdeas) and pass tokens:
 *   SEQ_A_TOKEN=dyp_... SEQ_B_TOKEN=dyp_... RAND_TOKEN=dyp_... CAT=systems
 * Verifies: sequence advances 0 -> step -> 2*step -> wrap on submit only,
 * two sequence profiles keep separate cursors, random stays in list.
 */
import assert from "node:assert/strict";
const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
if (/^https:\/\/(blog\.dypol|dypolblog\.rstmcsoch|dypol-blog\.rstmcsoch)\.workers\.dev\/?$/.test(BASE)) throw new Error("Refusing production.");
const SEQ_A = process.env.SEQ_A_TOKEN ?? "", SEQ_B = process.env.SEQ_B_TOKEN ?? "", RAND = process.env.RAND_TOKEN ?? "";
const CAT = process.env.CAT ?? "systems";
assert.ok(SEQ_A && SEQ_B && RAND, "set SEQ_A_TOKEN, SEQ_B_TOKEN, RAND_TOKEN");
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
  return parsed && typeof parsed === "object" && "ok" in parsed ? parsed : { ok: !parsed.error, data: parsed, error: parsed.error };
}
const words = (n, s) => Array.from({ length: n }, (_, i) => `${s}${i % 13}word`).join(" ");
async function selection(token) { const r = await call(token, "get_blog_settings"); return r.data.automation.selection; }
async function submit(token, k) {
  const sel = await selection(token);
  const r = await call(token, "submit_article_draft", { idempotency_key: `topic-sel-${run}-${k}`, title: `Topic selection probe ${run} ${k}`, excerpt: "Submitted by the topic-selection e2e to verify cursor movement.", body: `## Why\n\n${words(90, "alpha")}\n\n${words(70, "beta")}`, category: CAT, tags: [], source_urls: ["https://developers.cloudflare.com/d1/", "https://modelcontextprotocol.io/specification"], topic_idea_used: sel.suggestedTopic ?? undefined, used_topic_index: sel.suggestedIndex ?? undefined });
  assert.equal(r.ok, true, JSON.stringify(r));
  return sel;
}
await check("sequence: get_blog_settings suggests without advancing; submit advances by step and wraps", async () => {
  const step = (await selection(SEQ_A)).step;
  const seen = [];
  for (let i = 0; i < 4; i++) { const before = await selection(SEQ_A); const again = await selection(SEQ_A); assert.equal(again.suggestedIndex, before.suggestedIndex, "reading settings must not advance"); seen.push(before.suggestedIndex); await submit(SEQ_A, `a${i}`); }
  const expected = [0, step % 8, (2 * step) % 8, (3 * step) % 8];
  assert.deepEqual(seen, expected, `sequence with step ${step}`);
});
await check("profile independence: second sequence profile kept its own cursor", async () => {
  assert.equal((await selection(SEQ_B)).suggestedIndex, 0);
});
await check("random: suggested topic always from the list", async () => {
  for (let i = 0; i < 5; i++) { const s = await selection(RAND); assert.equal(s.mode, "random"); assert.ok(s.suggestedIndex >= 0 && s.suggestedIndex < 8, JSON.stringify(s)); }
});
console.log(failures ? `\n${failures} check(s) failed` : "\nall topic selection checks passed");
process.exit(failures ? 1 : 0);
