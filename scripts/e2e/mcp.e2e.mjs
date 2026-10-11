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
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const TOKEN = process.env.MCP_TOKEN ?? "";
const CATEGORY = process.env.CATEGORY ?? "cat-systems";
const OTHER = process.env.OTHER_CATEGORY ?? "cat-design";
if (/^https:\/\/(dypolblog|dypol-blog)\.rstmcsoch\.workers\.dev\/?$/.test(BASE)) throw new Error("Refusing to run against production.");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
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
  assert.equal(tools.length, 6);
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

await check("tools/list exposes exactly the six automation tools", async () => {
  await pace();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "get_blog_settings", "list_recent_articles", "publish_article_if_allowed", "record_run_result", "submit_article_draft", "upload_featured_image",
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

await check("draft creation: valid article becomes a draft with only advisory flags", async () => {
  const { isError, data } = await call(client, "submit_article_draft", article({ k: "good" }));
  assert.equal(isError, false, JSON.stringify(data));
  assert.equal(data.status, "draft");
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

await check("policy: flagged draft (short, unsourced, uncertain) stays a draft with reasons", async () => {
  const { data } = await call(client, "submit_article_draft", article({ k: "flagged", body: "Too short to publish.", sources: [], extra: { uncertain: true } }));
  assert.ok(data.flags.includes("too_short") && data.flags.includes("missing_sources") && data.flags.includes("self_reported_uncertain"));
  flagged = data;
  const p = await call(client, "publish_article_if_allowed", { article_id: flagged.article_id });
  assert.equal(p.data.published, false);
  assert.match(p.data.reasons.join(" "), /too_short/);
});

await check("policy: category outside the allow-list stays a draft", async () => {
  const { data } = await call(client, "submit_article_draft", article({ k: "othercat", category: OTHER }));
  const p = await call(client, "publish_article_if_allowed", { article_id: data.article_id });
  assert.equal(p.data.published, false);
  assert.match(p.data.reasons.join(" "), /allowed list/);
});

await check("policy: non-automation articles can never be published by automation", async () => {
  const list = await call(client, "list_recent_articles", { limit: 50 });
  const manual = list.data.articles.find((a) => !a.automated);
  assert.ok(manual, "a manual article exists");
  const p = await call(client, "publish_article_if_allowed", { article_id: manual.id });
  assert.equal(p.isError, true);
});

let mediaId;
await check("image: real PNG bytes stored in R2 and attached as cover; flag cleared", async () => {
  const { isError, data } = await call(client, "upload_featured_image", { article_id: good.article_id, image_base64: PNG.toString("base64"), alt: "Test pixel", filename: "probe.png" });
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
  const r = await call(client, "upload_featured_image", { url: process.env.IMAGE_URL ?? "https://www.gstatic.com/images/branding/product/2x/googleg_48dp.png", alt: "Remote test image" });
  assert.equal(r.isError, false, JSON.stringify(r.data));
  assert.equal(r.data.mime, "image/png");
});

await check("policy: clean allowed draft is published only through the policy", async () => {
  const p = await call(client, "publish_article_if_allowed", { article_id: good.article_id });
  assert.equal(p.data.published, true, JSON.stringify(p.data));
  await pace();
  const page = await fetch(`${BASE}${p.data.path}`);
  assert.equal(page.status, 200);
  const again = await call(client, "publish_article_if_allowed", { article_id: good.article_id });
  assert.equal(again.data.published, false, "second publish is a no-op");
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
  const r = await raw(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", pad: "x".repeat(2_600_000) }), { authorization: `Bearer ${TOKEN}` });
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
