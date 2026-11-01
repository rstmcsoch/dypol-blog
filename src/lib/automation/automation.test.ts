import assert from "node:assert/strict";
import test from "node:test";
import { blocksToBody, bodyToBlocks, contentHash, wordCount } from "./body.ts";
import { decodeBase64Image, fetchImage, ImageIntakeError, MAX_IMAGE_BYTES, sniffImage, unsafeUrlReason } from "./image-fetch.ts";
import { draftFlags, publishDecision, sourceProblems } from "./policy.ts";
import { buildRequest, configuredKeyNames, generateWithServerApi, parseResponse, providerStatus, ProviderError } from "./provider.ts";
import { SERVER_API_PROVIDERS } from "./settings.ts";
import { automationActive, DEFAULT_AUTOMATION_SETTINGS, normalizeAutomationSettings } from "./settings.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
const policy = { ...DEFAULT_AUTOMATION_SETTINGS.policy };

test("defaults are safe: automation off, auto-publish off", () => {
  assert.equal(DEFAULT_AUTOMATION_SETTINGS.enabled, false);
  assert.equal(DEFAULT_AUTOMATION_SETTINGS.policy.autoPublish, false);
  assert.equal(DEFAULT_AUTOMATION_SETTINGS.mode, "mcp-connector");
  assert.deepEqual(normalizeAutomationSettings({ enabled: "yes" }), DEFAULT_AUTOMATION_SETTINGS);
  assert.equal(normalizeAutomationSettings({ enabled: true, policy: { minWords: 300 } }).policy.minWords, 300);
  assert.deepEqual(automationActive({ ...DEFAULT_AUTOMATION_SETTINGS, enabled: true, paused: true }), { active: false, reason: "Automation is paused in the admin panel." });
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
  const base = { active: { active: true, reason: null }, status: "draft", categoryIds: ["cat-a"], flags: [], publishedThisRun: 0 };
  const off = publishDecision({ ...base, policy });
  assert.equal(off.publish, false);
  assert.match((off as { reasons: string[] }).reasons.join(" "), /Auto-publish is off/);
  const on = { ...policy, autoPublish: true, allowedCategoryIds: ["cat-a"] };
  assert.deepEqual(publishDecision({ ...base, policy: on }), { publish: true });
  assert.deepEqual(publishDecision({ ...base, policy: on, flags: ["needs_featured_image", "unknown_tags_dropped"] }), { publish: true });
  assert.equal(publishDecision({ ...base, policy: { ...on, requireFeaturedImage: true }, flags: ["needs_featured_image"] }).publish, false);
  assert.equal(publishDecision({ ...base, policy: on, categoryIds: ["cat-b"] }).publish, false);
  assert.equal(publishDecision({ ...base, policy: on, flags: ["too_short"] }).publish, false);
  assert.equal(publishDecision({ ...base, policy: { ...on, maxPublishedPerRun: 1 }, publishedThisRun: 1 }).publish, false);
  assert.equal(publishDecision({ ...base, policy: on, status: "published" }).publish, false);
  assert.equal(publishDecision({ ...base, policy: on, active: { active: false, reason: "paused" } }).publish, false);
});

test("publish policy: every failing rule keeps the draft with a reason", () => {
  const base = { active: { active: true, reason: null }, status: "draft", categoryIds: ["ai"], flags: [], publishedThisRun: 0, policy: { ...policy, autoPublish: true, allowedCategoryIds: ["ai"], requireFeaturedImage: false, maxPublishedPerRun: 3 } };
  const dec = (o: object) => publishDecision({ ...base, ...o } as never);
  assert.equal((dec({ policy: { ...base.policy, autoPublish: false } }) as {publish:boolean}).publish, false);
  // Empty allowlist = every topic allowed (t44); any one matching topic is enough.
  assert.deepEqual(dec({ policy: { ...base.policy, allowedCategoryIds: [] } }), { publish: true });
  assert.deepEqual(dec({ categoryIds: ["design", "ai"] }), { publish: true });
  assert.match((dec({ policy: { ...base.policy, allowedCategoryIds: ["design"] } }) as {reasons:string[]}).reasons.join(" "), /None of its topics is on the policy's allowed list/);
  assert.equal((dec({ flags: ["too_short"] }) as {publish:boolean}).publish, false);
  assert.equal((dec({ flags: ["needs_featured_image"], policy: { ...base.policy, requireFeaturedImage: true } }) as {publish:boolean}).publish, false);
  assert.deepEqual(dec({ flags: ["needs_featured_image"], policy: { ...base.policy, requireFeaturedImage: false } }), { publish: true });
  assert.equal((dec({ publishedThisRun: 3 }) as {publish:boolean}).publish, false);
  assert.deepEqual(dec({}), { publish: true });
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
  assert.throws(() => decodeBase64Image(Buffer.alloc(MAX_IMAGE_BYTES + 10, 0xff).toString("base64")), /10 MB/);
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
    /10 MB/,
  );
  const loop = fakeFetch({ "https://a.org/l": () => new Response(null, { status: 302, headers: { location: "https://a.org/l" } }) });
  await assert.rejects(fetchImage("https://a.org/l", loop), /Too many redirects/);
});

test("settings: legacy grok-mcp / xai-api values migrate; base URL validated", () => {
  const legacy = normalizeAutomationSettings({ enabled: true, provider: "grok-mcp" });
  assert.equal(legacy.mode, "mcp-connector");
  assert.equal(legacy.enabled, true, "migration keeps other settings");
  assert.equal("provider" in legacy, false);
  const legacyApi = normalizeAutomationSettings({ provider: "xai-api" });
  assert.equal(legacyApi.mode, "server-api");
  assert.equal(legacyApi.serverApi.provider, "xai");
  const badBase = normalizeAutomationSettings({ enabled: true, serverApi: { provider: "openai-compatible", model: "m", baseUrl: "http://10.0.0.1/v1" } });
  assert.equal(badBase.enabled, true, "an invalid serverApi block falls back alone");
  assert.equal(badBase.serverApi.provider, "openai");
  for (const baseUrl of ["http://api.example.com/v1", "https://localhost/v1", "https://127.0.0.1/v1", "https://svc.internal/v1", ""]) {
    assert.equal(normalizeAutomationSettings({ serverApi: { provider: "openai-compatible", model: "m", baseUrl } }).serverApi.baseUrl, "", baseUrl);
  }
  assert.equal(
    normalizeAutomationSettings({ serverApi: { provider: "openai-compatible", model: "m", baseUrl: "https://api.together.xyz/v1" } }).serverApi.baseUrl,
    "https://api.together.xyz/v1",
  );
  assert.deepEqual(normalizeAutomationSettings({ extraClientHosts: ["Connectors.Example.com"] }).extraClientHosts, ["connectors.example.com"]);
  assert.deepEqual(normalizeAutomationSettings({ extraClientHosts: ["https://x"] }), DEFAULT_AUTOMATION_SETTINGS);
});

test("provider status: mcp-connector by default; server-api only with mode AND key; key names only", () => {
  const s = { ...DEFAULT_AUTOMATION_SETTINGS };
  assert.equal(providerStatus(s, {}).active, "mcp-connector");
  assert.equal(providerStatus(s, { OPENAI_API_KEY: "k" }).active, "mcp-connector", "key alone does nothing");
  const api = { ...s, mode: "server-api" as const };
  assert.equal(providerStatus(api, {}).active, "mcp-connector", "mode alone does nothing");
  const on = providerStatus(api, { OPENAI_API_KEY: "secret-value" });
  assert.equal(on.active, "server-api");
  assert.equal(on.serverApi.keySecret, "OPENAI_API_KEY");
  assert.equal(JSON.stringify(on).includes("secret-value"), false, "never exposes key values");
  assert.equal(providerStatus({ ...api, serverApi: { provider: "anthropic", model: "", baseUrl: "" } }, { AI_API_KEY: "k" }).serverApi.keySecret, "AI_API_KEY");
  assert.deepEqual(configuredKeyNames({ XAI_API_KEY: "a", GEMINI_API_KEY: " " }), ["XAI_API_KEY"]);
});

test("server-api adapters: request shape per provider, parse responses, mocked fetch only", async () => {
  const input = { system: "sys", prompt: "hello" };
  const cases = {
    xai: ["https://api.x.ai/v1/chat/completions", "authorization"],
    openai: ["https://api.openai.com/v1/chat/completions", "authorization"],
    openrouter: ["https://openrouter.ai/api/v1/chat/completions", "authorization"],
    anthropic: ["https://api.anthropic.com/v1/messages", "x-api-key"],
    gemini: ["https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent", "x-goog-api-key"],
  } as const;
  for (const [provider, [url, header]] of Object.entries(cases)) {
    const r = buildRequest({ provider: provider as (typeof SERVER_API_PROVIDERS)[number], model: "", baseUrl: "" }, "KEY", input);
    assert.equal(r.url, url, provider);
    assert.ok(Object.values(r.init.headers).some((v) => v.includes("KEY")) && header in r.init.headers, provider);
    assert.equal(r.url.includes("KEY") || r.init.body.includes("KEY"), false, "key only in a header");
  }
  const compat = buildRequest({ provider: "openai-compatible", model: "llama", baseUrl: "https://api.example.com/v1/" }, "K", input);
  assert.equal(compat.url, "https://api.example.com/v1/chat/completions");
  assert.throws(() => buildRequest({ provider: "openai-compatible", model: "m", baseUrl: "https://10.1.1.1/v1" }, "K", input), ProviderError);
  assert.throws(() => buildRequest({ provider: "openai-compatible", model: "", baseUrl: "https://api.example.com" }, "K", input), /model id/);
  assert.equal(parseResponse("openai", { choices: [{ message: { content: "hi" } }] }), "hi");
  assert.equal(parseResponse("anthropic", { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }), "ab");
  assert.equal(parseResponse("gemini", { candidates: [{ content: { parts: [{ text: "g" }] } }] }), "g");
  assert.throws(() => parseResponse("openai", {}), ProviderError);

  let calls: string[] = [];
  const mock = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ content: [{ type: "text", text: "draft" }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const base = { ...DEFAULT_AUTOMATION_SETTINGS, serverApi: { provider: "anthropic" as const, model: "", baseUrl: "" } };
  await assert.rejects(generateWithServerApi(base, { ANTHROPIC_API_KEY: "k" }, input, mock), /No request was made/);
  await assert.rejects(generateWithServerApi({ ...base, mode: "server-api" }, {}, input, mock), /No request was made/);
  assert.equal(calls.length, 0);
  assert.equal(await generateWithServerApi({ ...base, mode: "server-api" }, { ANTHROPIC_API_KEY: "k" }, input, mock), "draft");
  assert.deepEqual(calls, ["https://api.anthropic.com/v1/messages"]);
  calls = [];
  const fail = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(generateWithServerApi({ ...base, mode: "server-api" }, { ANTHROPIC_API_KEY: "k" }, input, fail), /401/);
});

test("cover size check: rejects the 75-byte/1px placeholder, accepts real sizes", async () => {
  const { assertUsableCover, imageSize } = await import("./image-fetch.ts");
  assert.deepEqual(imageSize(PNG, "image/png"), { width: 1, height: 1 });
  assert.throws(() => assertUsableCover(PNG, "image/png"), /at least 400x200/);
  const big = Buffer.from(PNG);
  big.writeUInt32BE(1200, 16);
  big.writeUInt32BE(675, 20);
  assert.deepEqual(assertUsableCover(big, "image/png"), { width: 1200, height: 675 });
  // JPEG: SOI, APP0 (len 16), SOF0 with 640x480
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(imageSize(jpeg, "image/jpeg"), { width: 640, height: 480 });
  // WebP VP8X 800x600
  const webp = Buffer.alloc(30);
  webp.write("RIFF", 0);
  webp.write("WEBP", 8);
  webp.write("VP8X", 12);
  webp.writeUIntLE(799, 24, 3);
  webp.writeUIntLE(599, 27, 3);
  assert.deepEqual(imageSize(webp, "image/webp"), { width: 800, height: 600 });
  assert.throws(() => assertUsableCover(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg"), /Could not read/);
});

test("image fetch sends a descriptive User-Agent (Wikimedia and CDNs 403 without one)", async () => {
  let ua = "";
  const fake = (async (_url: string, init: RequestInit) => {
    ua = new Headers(init.headers).get("user-agent") ?? "";
    return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  }) as unknown as typeof fetch;
  await fetchImage("https://example.org/a.png", fake);
  assert.match(ua, /DYPOL-Blog/);
});

test("bug fix: one invalid stored field no longer resets (and disables) all automation settings", () => {
  const out = normalizeAutomationSettings({ enabled: true, topicIdeas: ["ok"], topicSources: ["https://a.example", "not a url"], policy: { autoPublish: true, maxPublishedPerDay: 50 } });
  assert.equal(out.enabled, true);
  assert.deepEqual(out.topicIdeas, ["ok"]);
  assert.deepEqual(out.topicSources, ["https://a.example"]);
  assert.equal(out.policy.autoPublish, true);
  assert.equal(out.policy.maxPublishedPerRun, DEFAULT_AUTOMATION_SETTINGS.policy.maxPublishedPerRun);
});

test("t91: markdown pipe table becomes a table block and round-trips", () => {
  const blocks = bodyToBlocks("Intro.\n\n| Model | Score |\n|---|---|\n| A | 10 |\n| B | 8 |\n\nAfter.");
  const table = blocks.find((b) => b.type === "table");
  assert.ok(table && table.type === "table");
  assert.deepEqual(table.headers, ["Model", "Score"]);
  assert.deepEqual(table.rows, [["A", "10"], ["B", "8"]]);
  assert.ok(wordCount(blocks) >= 8);
  const again = bodyToBlocks(blocksToBody(blocks));
  assert.deepEqual(again.find((b) => b.type === "table"), table);
});

test("t91: 'At a glance' heading + list becomes a takeaways box and round-trips", () => {
  const blocks = bodyToBlocks("## At a glance\n- Result one\n- Who is affected\n- Main caveat\n\n## Body\nText.");
  assert.deepEqual(blocks[0], { type: "takeaways", items: ["Result one", "Who is affected", "Main caveat"] });
  const again = bodyToBlocks(blocksToBody(blocks));
  assert.deepEqual(again[0], blocks[0]);
});

test("t106: specs fence, specs heading + table, callouts, nested lists, divider, h4, alignment", async () => {
  const { stripCreditsAndSources } = await import("./body.ts");
  const body = [
    "## At a glance",
    "- **One** result",
    "- Who",
    "- Caveat",
    "",
    "```specs Pixel 11 Pro",
    "Display: 6.3-inch OLED, **120Hz**",
    "Battery: 5,000mAh",
    "```",
    "",
    "### Key specs",
    "| Spec | Value |",
    "|---|---|",
    "| Chip | Tensor G6 |",
    "| RAM | 16GB |",
    "",
    "> **Key takeaway:** Prices stay flat.",
    "",
    "> **Note:** Vendor-reported.",
    "",
    "> Quote text",
    "> — Sundar Pichai",
    "",
    "- Parent",
    "  - Child a",
    "  - Child b",
    "- Second",
    "",
    "---",
    "",
    "#### Small head",
    "",
    "| Model | Score |",
    "|:---|---:|",
    "| A | 77.0 |",
    "",
    "Cover image: Image: DeepSeek (https://x.example)",
    "",
    "## Sources",
    "- https://a.example",
  ].join("\n");
  const blocks = bodyToBlocks(body);
  const types = blocks.map((b) => b.type);
  assert.deepEqual(types, ["takeaways", "specs", "specs", "callout", "callout", "quote", "list", "divider", "heading", "table", "paragraph", "heading", "list"]);
  const specs = blocks[1] as { title?: string; rows: string[][] };
  assert.equal(specs.title, "Pixel 11 Pro");
  assert.deepEqual(specs.rows[0], ["Display", "6.3-inch OLED, **120Hz**"]);
  assert.deepEqual((blocks[2] as { rows: string[][] }).rows, [["Chip", "Tensor G6"], ["RAM", "16GB"]]);
  assert.equal((blocks[3] as { tone: string }).tone, "takeaway");
  assert.equal((blocks[3] as { text: string }).text, "Prices stay flat.");
  assert.equal((blocks[5] as { attribution?: string }).attribution, "Sundar Pichai");
  assert.deepEqual((blocks[6] as { children?: string[][] }).children, [["Child a", "Child b"], []]);
  assert.equal((blocks[8] as { level: number }).level, 4);
  assert.deepEqual((blocks[9] as { align?: string[] }).align, ["left", "right"]);
  const cleaned = stripCreditsAndSources(blocks).map((b) => b.type);
  assert.deepEqual(cleaned, types.slice(0, 10));
  // Round trip keeps structure.
  assert.deepEqual(bodyToBlocks(blocksToBody(blocks)), blocks);
});

test("t106: inline markdown — bold/italic/links/entities, unsafe links stay text", async () => {
  const { parseInline, isExternalHref, inlinePlain } = await import("../inline-markdown.ts");
  assert.deepEqual(parseInline("the **V4.1-Flash-1017** model"), [
    { t: "text", v: "the " },
    { t: "strong", c: [{ t: "text", v: "V4.1-Flash-1017" }] },
    { t: "text", v: " model" },
  ]);
  assert.equal(inlinePlain("***x*** *y* _z_ ~~w~~ 5 * 3 snake_case &times; &#8594;"), "x y z w 5 * 3 snake_case × →");
  const bad = parseInline("[x](javascript:alert(1)) <b>hi</b>");
  assert.ok(bad.every((n) => n.t === "text"));
  const link = parseInline("see https://a.example/b).")[1] as { t: string; href: string };
  assert.equal(link.href, "https://a.example/b");
  assert.equal(isExternalHref("https://www.dypol.example/x", ["dypol.example:443"]), false);
  assert.equal(isExternalHref("https://other.example/x", ["dypol.example"]), true);
  assert.equal(isExternalHref("/articles/x", ["dypol.example"]), false);
});

test("t166: an At a glance box written after the body moves to the top; order is otherwise kept", async () => {
  const { bodyToBlocks, placeSummaryFirst } = await import("./body.ts");
  const blocks = placeSummaryFirst(bodyToBlocks("First para.\n\nSecond para.\n\n## At a glance\n- One\n- Two\n\n> **Key takeaway:** Done."));
  assert.deepEqual(blocks.map((b) => b.type), ["takeaways", "paragraph", "paragraph", "callout"]);
  const already = bodyToBlocks("## At a glance\n- One\n\nIntro.");
  assert.equal(placeSummaryFirst(already), already);
});
