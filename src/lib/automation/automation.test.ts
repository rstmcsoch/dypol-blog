import assert from "node:assert/strict";
import test from "node:test";
import { bodyToBlocks, contentHash, wordCount } from "./body.ts";
import { decodeBase64Image, fetchImage, ImageIntakeError, MAX_IMAGE_BYTES, sniffImage, unsafeUrlReason } from "./image-fetch.ts";
import { draftFlags, publishDecision, sourceProblems } from "./policy.ts";
import { providerStatus, runXaiProvider } from "./provider.ts";
import { automationActive, DEFAULT_AUTOMATION_SETTINGS, normalizeAutomationSettings } from "./settings.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
const policy = { ...DEFAULT_AUTOMATION_SETTINGS.policy };

test("defaults are safe: automation off, auto-publish off", () => {
  assert.equal(DEFAULT_AUTOMATION_SETTINGS.enabled, false);
  assert.equal(DEFAULT_AUTOMATION_SETTINGS.policy.autoPublish, false);
  assert.equal(DEFAULT_AUTOMATION_SETTINGS.provider, "grok-mcp");
  assert.deepEqual(normalizeAutomationSettings({ enabled: "yes" }), DEFAULT_AUTOMATION_SETTINGS);
  assert.equal(normalizeAutomationSettings({ enabled: true, policy: { minWords: 300 } }).policy.minWords, 300);
  assert.deepEqual(automationActive({ ...DEFAULT_AUTOMATION_SETTINGS, enabled: true, paused: true }), { active: false, reason: "Automation is paused in the desk." });
});

test("body converts to blocks and counts words", async () => {
  const blocks = bodyToBlocks("# Big\n\nIntro line one\nline two.\n\n## Part\n- a\n- b\n\n1. x\n2. y\n\n> quoted\n\n```ts\nconst a = 1;\n```\n<b>no html</b>");
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "paragraph", "heading", "list", "list", "quote", "code", "paragraph"]);
  assert.equal((blocks[1] as { text: string }).text, "Intro line one line two.");
  assert.equal((blocks[4] as { ordered?: boolean }).ordered, true);
  assert.equal(wordCount(bodyToBlocks("one two three\n\n- four five")), 5);
  assert.equal(await contentHash("T", "A  b"), await contentHash("t", "a b"));
  assert.notEqual(await contentHash("T", "a"), await contentHash("T", "b"));
});

test("source URLs: https public hosts only", () => {
  const r = sourceProblems(["https://news.example.org/a", "http://x.org", "https://127.0.0.1/a", "nope", "https://example.com/x", "https://news.example.org/a"]);
  assert.deepEqual(r.valid, ["https://news.example.org/a"]);
  assert.equal(r.invalid.length, 4);
});

test("draft flags", () => {
  const flags = draftFlags({ words: 100, sourceUrls: ["https://a.org/1"], text: "lorem ipsum", policy, duplicateTitle: true, uncertain: true, hasImage: false, droppedTags: 1 });
  assert.deepEqual(new Set(flags), new Set(["too_short", "insufficient_sources", "placeholder_text", "duplicate_title", "self_reported_uncertain", "needs_featured_image", "unknown_tags_dropped"]));
  assert.deepEqual(draftFlags({ words: 900, sourceUrls: ["https://a.org/1", "https://b.org/2"], text: "fine", policy, duplicateTitle: false, uncertain: false, hasImage: true, droppedTags: 0 }), []);
  assert.ok(draftFlags({ words: 900, sourceUrls: [], text: "", policy, duplicateTitle: false, uncertain: false, hasImage: true, droppedTags: 0 }).includes("missing_sources"));
});

test("publish policy: default keeps drafts; only explicit rules publish", () => {
  const base = { active: { active: true, reason: null }, status: "draft", categoryId: "cat-a", flags: [], publishedToday: 0 };
  const off = publishDecision({ ...base, policy });
  assert.equal(off.publish, false);
  assert.match((off as { reasons: string[] }).reasons.join(" "), /Auto-publish is off/);
  const on = { ...policy, autoPublish: true, allowedCategoryIds: ["cat-a"] };
  assert.deepEqual(publishDecision({ ...base, policy: on }), { publish: true });
  assert.deepEqual(publishDecision({ ...base, policy: on, flags: ["needs_featured_image", "unknown_tags_dropped"] }), { publish: true });
  assert.equal(publishDecision({ ...base, policy: { ...on, requireFeaturedImage: true }, flags: ["needs_featured_image"] }).publish, false);
  assert.equal(publishDecision({ ...base, policy: on, categoryId: "cat-b" }).publish, false);
  assert.equal(publishDecision({ ...base, policy: on, flags: ["too_short"] }).publish, false);
  assert.equal(publishDecision({ ...base, policy: on, publishedToday: 1 }).publish, false);
  assert.equal(publishDecision({ ...base, policy: on, status: "published" }).publish, false);
  assert.equal(publishDecision({ ...base, policy: on, active: { active: false, reason: "paused" } }).publish, false);
});

test("image intake: magic bytes, size cap, base64", () => {
  assert.equal(sniffImage(PNG), "image/png");
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImage(new TextEncoder().encode("RIFF0000WEBPVP8 ")), "image/webp");
  assert.equal(sniffImage(new TextEncoder().encode("GIF89a")), null);
  assert.equal(sniffImage(new TextEncoder().encode("<svg xmlns=")), null);
  assert.equal(decodeBase64Image(PNG.toString("base64")).mime, "image/png");
  assert.equal(decodeBase64Image(`data:image/png;base64,${PNG.toString("base64")}`).bytes.length, PNG.length);
  assert.throws(() => decodeBase64Image(Buffer.from("<html>").toString("base64")), ImageIntakeError);
  assert.throws(() => decodeBase64Image("!!!"), ImageIntakeError);
  assert.throws(() => decodeBase64Image(Buffer.alloc(MAX_IMAGE_BYTES + 10, 0xff).toString("base64")), /1.5 MB/);
});

test("SSRF guard rejects unsafe URLs", () => {
  for (const bad of [
    "http://cdn.example.org/a.png",
    "https://127.0.0.1/a.png",
    "https://[::1]/a.png",
    "https://10.0.0.5/a.png",
    "https://2130706433/a.png",
    "https://0x7f000001/a.png",
    "https://localhost/a.png",
    "https://metadata.internal/a.png",
    "https://printer.local/a.png",
    "https://intranet/a.png",
    "https://user:pw@cdn.example.org/a.png",
    "https://cdn.example.org:8443/a.png",
    "file:///etc/passwd",
  ]) {
    assert.ok(unsafeUrlReason(bad), bad);
  }
  assert.equal(unsafeUrlReason("https://upload.wikimedia.org/a.png"), null);
});

function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const key = String(input);
    const make = routes[key];
    if (!make) throw new Error(`unexpected fetch ${key}`);
    return make();
  }) as typeof fetch;
}

test("fetchImage follows safe redirects, blocks unsafe hops, enforces type and size", async () => {
  const ok = await fetchImage(
    "https://a.org/x",
    fakeFetch({
      "https://a.org/x": () => new Response(null, { status: 302, headers: { location: "https://cdn.a.org/y.png" } }),
      "https://cdn.a.org/y.png": () => new Response(PNG, { headers: { "content-type": "image/png" } }),
    }),
  );
  assert.equal(ok.mime, "image/png");
  assert.equal(ok.finalUrl, "https://cdn.a.org/y.png");
  await assert.rejects(
    fetchImage("https://a.org/x", fakeFetch({ "https://a.org/x": () => new Response(null, { status: 301, headers: { location: "https://169.254.169.254/latest" } }) })),
    /IP-literal/,
  );
  await assert.rejects(fetchImage("https://a.org/h", fakeFetch({ "https://a.org/h": () => new Response("<html>", { headers: { "content-type": "image/png" } }) })), /did not return/);
  await assert.rejects(
    fetchImage("https://a.org/big", fakeFetch({ "https://a.org/big": () => new Response(new Uint8Array(MAX_IMAGE_BYTES + 1).fill(0xff)) })),
    /1.5 MB/,
  );
  const loop = fakeFetch({ "https://a.org/l": () => new Response(null, { status: 302, headers: { location: "https://a.org/l" } }) });
  await assert.rejects(fetchImage("https://a.org/l", loop), /Too many redirects/);
});

test("provider: grok-mcp active; xai-api inert without key; never makes requests", async () => {
  const s = { ...DEFAULT_AUTOMATION_SETTINGS };
  assert.equal(providerStatus(s, {}).active, "grok-mcp");
  assert.equal(providerStatus({ ...s, provider: "xai-api" }, {}).active, "grok-mcp");
  assert.equal(providerStatus({ ...s, provider: "xai-api" }, { XAI_API_KEY: "k" }).active, "xai-api");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response();
  }) as typeof fetch;
  try {
    await assert.rejects(runXaiProvider(), /No request was made/);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(calls, 0);
});
