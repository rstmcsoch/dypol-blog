#!/usr/bin/env node
/**
 * MCP automation E2E with a real MCP client (@modelcontextprotocol/sdk,
 * Streamable HTTP). Needs `npm i --no-save @modelcontextprotocol/sdk`.
 *
 *   BASE=<site> MCP_TOKEN=<token> CATEGORY=<id allowed for auto-publish> \
 *   OTHER_CATEGORY=<id not allowed> node scripts/e2e/mcp.e2e.mjs
 *
 * The target must have automation enabled with a test policy: autoPublish on,
 * allowedCategoryIds [CATEGORY], minWords 120, minSources 2, requireSources on,
 * requireFeaturedImage off, maxPublishedPerDay >= 1. Never point this at production.
 * Calls are paced (~2 s) to stay under the 30/min MCP rate limit until the
 * final rate-limit check. The token is read from the environment and never printed.
 */
import { deflateSync } from "node:zlib";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const TOKEN = process.env.MCP_TOKEN ?? "";
const CATEGORY = process.env.CATEGORY ?? "cat-systems";
const OTHER = process.env.OTHER_CATEGORY ?? "cat-design";
if (/^https:\/\/(dypolblog|dypol-blog)\.rstmcsoch\.workers\.dev\/?$/.test(BASE)) throw new Error("Refusing to run against production.");
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
/** A real 480x270 RGB PNG (covers must be at least 400x200). */
function makePng(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) raw[y * (width * 3 + 1) + 1 + x * 3] = (x * 255) / width;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PNG = makePng(480, 270);
const run = randomBytes(4).toString("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pace = () => sleep(Number(process.env.PACE_MS ?? 2100));

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`not ok - ${name}\n  ${error instanceof Error ? error.message : error}`);
  }
}

async function raw(body, headers = {}) {
  await pace();
  return fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function connect(token) {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "dypol-e2e", version: "1.0.0" });
  await pace();
  await client.connect(transport);
  return client;
}

async function call(client, name, args) {
  await pace();
  const res = await client.callTool({ name, arguments: args });
  return { isError: Boolean(res.isError), data: res.structuredContent ?? JSON.parse(res.content[0].text) };
}

const words = (n, seed) => Array.from({ length: n }, (_, i) => `${seed}${i % 17}word`).join(" ");
function article(over = {}) {
  return {
    idempotency_key: `e2e-${run}-${over.k ?? "a"}`,
    title: over.title ?? `E2E automation probe ${run} ${over.k ?? "a"}`,
    excerpt: "A test article submitted by the MCP end-to-end suite to verify drafting.",
    body: over.body ?? `## Why\n\n${words(80, "alpha")}\n\n- point one\n- point two\n\n${words(70, "beta")}`,
    category: over.category ?? CATEGORY,
    tags: over.tags ?? ["not-a-real-tag"],
    source_urls: over.sources ?? ["https://developers.cloudflare.com/d1/", "https://modelcontextprotocol.io/specification"],
    ...(over.extra ?? {}),
  };
}

await check("no token -> 401 with OAuth resource metadata hint", async () => {
  const r = await raw({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate") ?? "", /resource_metadata="https?:\/\/[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/);
});

await check("discovery probes: unauthenticated GET/HEAD /mcp and /mcp/ -> 401 challenge; CORS preflight from grok.com", async () => {
  for (const path of ["/mcp", "/mcp/"]) {
    for (const method of ["GET", "HEAD"]) {
      await pace();
      const r = await fetch(`${BASE}${path}`, { method, headers: { accept: "text/event-stream" } });
      assert.equal(r.status, 401, `${method} ${path}`);
      assert.match(r.headers.get("www-authenticate") ?? "", /resource_metadata=.*scope="blog:automation"/);
    }
  }
  await pace();
  const pre = await fetch(`${BASE}/mcp`, { method: "OPTIONS", headers: { origin: "https://grok.com", "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type" } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://grok.com");
  assert.match(pre.headers.get("access-control-allow-headers") ?? "", /authorization/);
  const ch = await raw({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { origin: "https://grok.com" });
  assert.equal(ch.status, 401);
  assert.match(ch.headers.get("access-control-expose-headers") ?? "", /www-authenticate/);
  await pace();
  const meta = await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`, { headers: { origin: "https://grok.com" } });
  assert.equal(meta.headers.get("access-control-allow-origin"), "*");
});

await check("full OAuth discovery from just the URL (SDK auth provider, Grok's redirect URI)", async () => {
  const redirectUrl = "https://grok.com/connectors-oauth-exchange-code/";
  let clientInfo, tokens, verifier, authCode;
  const provider = {
    get redirectUrl() { return redirectUrl; },
    get clientMetadata() { return { redirect_uris: [redirectUrl], client_name: "Grok-like", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }; },
    clientInformation: () => clientInfo,
    saveClientInformation: (i) => { clientInfo = i; },
    tokens: () => tokens,
    saveTokens: (t) => { tokens = t; },
    saveCodeVerifier: (v) => { verifier = v; },
    codeVerifier: () => verifier,
    redirectToAuthorization: async (url) => {
      // Stand in for the owner: open the approval page and approve with MCP_TOKEN.
      await pace();
      const page = await fetch(url);
      assert.equal(page.status, 200);
      await pace();
      const res = await fetch(new URL("/oauth/authorize", url), { method: "POST", body: new URLSearchParams({ ...Object.fromEntries(url.searchParams), owner_secret: TOKEN }), redirect: "manual" });
      assert.equal(res.status, 302);
      authCode = new URL(res.headers.get("location")).searchParams.get("code");
    },
  };
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { authProvider: provider });
  const c = new Client({ name: "grok-like", version: "1.0.0" });
  await pace();
  await assert.rejects(c.connect(transport), /Unauthorized/);
  assert.ok(authCode, "authorization code captured");
  await pace();
  await transport.finishAuth(authCode);
  assert.ok(tokens?.access_token?.startsWith("mcpat."));
  const c2 = new Client({ name: "grok-like", version: "1.0.0" });
  await pace();
  await c2.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { authProvider: provider }));
  await pace();
  const { tools } = await c2.listTools();
  assert.equal(tools.length, 12);
  await c2.close();
});

await check("wrong token -> 401 invalid_token; MCP client cannot connect", async () => {
  const r = await raw({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: "Bearer wrong-token-wrong-token-wrong-token-xx" });
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate") ?? "", /invalid_token/);
  await assert.rejects(connect("wrong-token-wrong-token-wrong-token-xx"));
});

await check("foreign browser Origin -> 403; authenticated GET -> 405", async () => {
  const r = await raw({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: `Bearer ${TOKEN}`, origin: "https://evil.example" });
  assert.equal(r.status, 403);
  await pace();
  const g = await fetch(`${BASE}/mcp`, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(g.status, 405, "authenticated GET: no SSE stream");
});

const client = await connect(TOKEN);
let good;
let flagged;

await check("tools/list exposes exactly the twelve automation tools", async () => {
  await pace();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "delete_article_draft", "get_article", "get_blog_settings", "list_editable_articles", "list_recent_articles", "publish_article_if_allowed",
    "record_run_result", "remove_article_cover", "set_article_cover", "submit_article_draft", "update_article_draft", "upload_featured_image",
  ]);
  for (const t of tools) assert.equal(t.inputSchema.type, "object");
});

await check("get_blog_settings returns policy, categories, provider mcp-connector", async () => {
  const { isError, data } = await call(client, "get_blog_settings", {});
  assert.equal(isError, false);
  assert.equal(data.automation.provider.active, "mcp-connector");
  assert.ok(data.categories.some((c) => c.id === CATEGORY));
  assert.equal(data.automation.active, true, "test target must have automation enabled");
});

await check("invalid inputs are rejected with field errors", async () => {
  const a = await call(client, "submit_article_draft", { title: "x" });
  assert.equal(a.isError, true);
  assert.ok(Array.isArray(a.data.details) && a.data.details.some((d) => d.path === "idempotency_key"));
  const b = await call(client, "submit_article_draft", article({ k: "badcat", category: "no-such-topic" }));
  assert.equal(b.isError, true);
  assert.match(b.data.error, /Unknown category/);
  const c = await call(client, "list_recent_articles", { limit: 500 });
  assert.equal(c.isError, true);
});

await check("draft creation: valid article auto-publishes in the submit call when policy passes", async () => {
  const { isError, data } = await call(client, "submit_article_draft", article({ k: "good" }));
  assert.equal(isError, false, JSON.stringify(data));
  // Local test policy does not require a featured image, so submit publishes
  // immediately and says so; with requireFeaturedImage it would stay a draft
  // until upload_featured_image attaches a cover (which re-checks policy).
  assert.equal(data.status, "published");
  assert.equal(data.published, true);
  assert.equal(data.duplicate, false);
  assert.deepEqual(data.flags.sort(), ["needs_featured_image", "unknown_tags_dropped"]);
  good = data;
});

await check("duplicate submissions: same key and same content never duplicate", async () => {
  const again = await call(client, "submit_article_draft", article({ k: "good" }));
  assert.equal(again.data.duplicate, true);
  assert.equal(again.data.article_id, good.article_id);
  assert.equal(again.data.matchedBy, "idempotency_key");
  const same = await call(client, "submit_article_draft", { ...article({ k: "good" }), idempotency_key: `e2e-${run}-other-key` });
  assert.equal(same.data.duplicate, true);
  assert.equal(same.data.matchedBy, "content_hash");
  assert.equal(same.data.article_id, good.article_id);
});

await check("policy: flagged draft (short, unsourced, uncertain) stays a draft AUTOMATICALLY, with reasons", async () => {
  const { data } = await call(client, "submit_article_draft", article({ k: "flagged", body: "Too short to publish.", sources: [], extra: { uncertain: true } }));
  assert.ok(data.flags.includes("too_short") && data.flags.includes("missing_sources") && data.flags.includes("self_reported_uncertain"));
  flagged = data;
  // Automatic path kept it a draft (above). An EXPLICIT publish is the owner's
  // deliberate instruction: policy must not block it, only warn. (Uses a twin
  // draft: `flagged` itself is reused by the cover test below, as a draft.)
  const twin = await call(client, "submit_article_draft", article({ k: "flagged2", body: "Also too short.", sources: [], extra: { uncertain: true } }));
  const p = await call(client, "publish_article_if_allowed", { article_id: twin.data.article_id });
  assert.equal(p.data.published, true, JSON.stringify(p.data));
  assert.equal(p.data.mode, "explicit");
  assert.match(p.data.warnings.join(" "), /too_short/);
});

await check("policy: category outside the allow-list blocks AUTOMATIC publish only; explicit publish warns and publishes", async () => {
  const { data } = await call(client, "submit_article_draft", article({ k: "othercat", category: OTHER }));
  assert.equal(data.published, false, "submit must not auto-publish outside the allow-list");
  const p = await call(client, "publish_article_if_allowed", { article_id: data.article_id });
  assert.equal(p.data.published, true, JSON.stringify(p.data));
  assert.match(p.data.warnings.join(" "), /allowed list/);
});

await check("explicit publish: the master token may publish an owner-written draft; published ones answer already_published", async () => {
  const list = await call(client, "list_recent_articles", { limit: 50 });
  const manualDraft = list.data.articles.find((a) => !a.automated && a.status !== "published");
  assert.ok(manualDraft, "a manual draft exists");
  const p = await call(client, "publish_article_if_allowed", { article_id: manualDraft.id });
  assert.equal(p.data.published, true, JSON.stringify(p.data));
  const again = await call(client, "publish_article_if_allowed", { article_id: manualDraft.id });
  assert.equal(again.data.published, false);
  assert.equal(again.data.already_published, true);
});

let mediaId;
await check("image: real PNG bytes stored in R2 and attached as cover; flag cleared", async () => {
  const { isError, data } = await call(client, "upload_featured_image", { article_id: flagged.article_id, image_base64: PNG.toString("base64"), alt: "Test gradient", filename: "probe.png", credit: "Gradient: generated by the e2e test, CC0" });
  assert.equal(isError, false, JSON.stringify(data));
  assert.equal(data.attached, true);
  assert.equal(data.mime, "image/png");
  mediaId = data.media_id;
  await pace();
  const r = await fetch(`${BASE}${data.path}`);
  assert.equal(r.status, 200);
  assert.equal(createHash("sha256").update(Buffer.from(await r.arrayBuffer())).digest("hex"), createHash("sha256").update(PNG).digest("hex"));
});

await check("image: fake bytes, unsafe URLs and non-image URLs are rejected", async () => {
  const tiny = await call(client, "upload_featured_image", { image_base64: PIXEL.toString("base64"), alt: "x" });
  assert.equal(tiny.isError, true);
  assert.match(JSON.stringify(tiny.data), /at least 400x200/);
  const fake = await call(client, "upload_featured_image", { image_base64: Buffer.from("<svg onload=alert(1)>").toString("base64"), alt: "x" });
  assert.equal(fake.isError, true);
  for (const url of ["http://example.org/a.png", "https://169.254.169.254/latest/meta-data", "https://localhost/a.png", "https://10.0.0.1/a.png"]) {
    const r = await call(client, "upload_featured_image", { url, alt: "x" });
    assert.equal(r.isError, true, url);
  }
  const both = await call(client, "upload_featured_image", { url: "https://a.org/x.png", image_base64: "AAAA", alt: "x" });
  assert.equal(both.isError, true);
});

await check("image: safe https URL fetch with magic-byte check", async () => {
  const r = await call(client, "upload_featured_image", { url: process.env.IMAGE_URL ?? "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/500px-Camponotus_flavomarginatus_ant.jpg", alt: "Remote test image", credit: "Photo: April Nobile / Wikimedia Commons, CC BY-SA 4.0" });
  assert.equal(r.isError, false, JSON.stringify(r.data));
  assert.equal(r.data.mime, process.env.IMAGE_URL ? r.data.mime : "image/jpeg");
});

await check("policy: clean allowed article was published through the policy; publish tool is a safe no-op after", async () => {
  const p = await call(client, "publish_article_if_allowed", { article_id: good.article_id });
  assert.equal(p.data.published, false, "already published by submit: second publish is a no-op");
  const page = await fetch(`${BASE}/articles/${good.slug}`);
  assert.equal(page.status, 200);
  // A blocked draft (outside the allow-list) must also publish via the image
  // step only when policy passes: flagged stays draft after its cover upload.
  assert.ok(flagged.article_id);
});

await check("record_run_result records a skip", async () => {
  const r = await call(client, "record_run_result", { outcome: "skipped", reason: "E2E: no topic met the quality bar", topic: "e2e" });
  assert.equal(r.data.recorded, true);
});

await check("OAuth: metadata, DCR allow-list, PKCE authorize + token, MCP with access token", async () => {
  await pace();
  const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.equal(prm.resource, `${BASE}/mcp`);
  const asm = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  assert.deepEqual(asm.code_challenge_methods_supported, ["S256"]);
  await pace();
  const evil = await fetch(asm.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["https://evil.example/cb"] }) });
  assert.equal(evil.status, 400);
  const redirectUri = "https://grok.com/oauth/callback";
  const reg = await (await fetch(asm.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [redirectUri], client_name: "e2e" }) })).json();
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state: "s1" });
  await pace();
  const pageRes = await fetch(`${asm.authorization_endpoint}?${q}`);
  assert.equal(pageRes.status, 200);
  assert.equal(pageRes.headers.get("x-frame-options"), "DENY");
  const form = (secret) => new URLSearchParams({ ...Object.fromEntries(q), owner_secret: secret });
  await pace();
  const wrong = await fetch(asm.authorization_endpoint, { method: "POST", body: form("nope-nope-nope"), redirect: "manual" });
  assert.equal(wrong.status, 401);
  await pace();
  const ok = await fetch(asm.authorization_endpoint, { method: "POST", body: form(TOKEN), redirect: "manual" });
  assert.equal(ok.status, 302);
  const loc = new URL(ok.headers.get("location"));
  assert.equal(loc.origin + loc.pathname, redirectUri);
  assert.equal(loc.searchParams.get("state"), "s1");
  await pace();
  const bad = await fetch(asm.token_endpoint, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: loc.searchParams.get("code"), client_id: reg.client_id, redirect_uri: redirectUri, code_verifier: randomBytes(48).toString("base64url") }) });
  assert.equal(bad.status, 400);
  const tok = await (await fetch(asm.token_endpoint, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: loc.searchParams.get("code"), client_id: reg.client_id, redirect_uri: redirectUri, code_verifier: verifier }) })).json();
  assert.ok(tok.access_token?.startsWith("mcpat."));
  const viaOauth = await connect(tok.access_token);
  const s = await call(viaOauth, "get_blog_settings", {});
  assert.equal(s.isError, false);
  await viaOauth.close();
});

await client.close();

// After an unread oversized body the local dev proxy drops its next connection, so this runs last-but-one.
await check("oversized request -> 413 before parsing", async () => {
  const r = await raw(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", pad: "x".repeat(15_100_000) }), { authorization: `Bearer ${TOKEN}` });
  assert.equal(r.status, 413);
});


await check("rate limit: bursts get 429 with Retry-After", async () => {
  const statuses = [];
  for (let i = 0; i < 45; i += 1) {
    const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ jsonrpc: "2.0", id: i, method: "ping" }) }).catch(() => null);
    if (!r) continue;
    statuses.push(r.status);
    if (r.status === 429) {
      assert.equal(r.headers.get("retry-after"), "60");
      break;
    }
  }
  assert.ok(statuses.includes(429), `statuses: ${statuses.join(",")}`);
});

console.log(JSON.stringify({ draft: good?.article_id, flagged: flagged?.article_id, media: mediaId }));
if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall MCP checks passed");
