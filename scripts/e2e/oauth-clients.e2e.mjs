#!/usr/bin/env node
/**
 * Any-AI-client OAuth regression: dynamic client registration + PKCE for
 * Claude-style, ChatGPT-style, loopback (Claude Code / VS Code / Gemini CLI style,
 * ephemeral port), Cursor custom scheme, and the legacy Grok client id; then
 * token exchange and MCP tools/list. Bad redirects must be rejected.
 * One Claude-style approval runs in real Chromium to prove the CSP allows the redirect.
 *
 *   BASE=<site> MCP_TOKEN=<token> node scripts/e2e/oauth-clients.e2e.mjs
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const TOKEN = process.env.MCP_TOKEN ?? "";
// Local MCP_LIMITER is 30 req / 60 s per bucket: wait out a 429 instead of failing.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  for (let i = 0; ; i += 1) {
    const res = await realFetch(input, init?.body instanceof URLSearchParams ? { ...init, body: new URLSearchParams(init.body) } : init);
    if (res.status !== 429 || i >= 2) return res;
    await new Promise((r) => setTimeout(r, 61_000));
  }
};
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

async function register(name, redirect_uris) {
  return fetch(`${BASE}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: name, redirect_uris }) });
}
function authorizeParams(clientId, redirectUri) {
  const verifier = randomBytes(48).toString("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state: "s-" + randomBytes(4).toString("hex"),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: `${BASE}/mcp`,
    scope: "blog:automation",
  });
  return { verifier, params };
}
async function approve(params, secret = TOKEN) {
  const form = new URLSearchParams(params);
  form.set("owner_secret", secret);
  return fetch(`${BASE}/oauth/authorize`, { method: "POST", body: form, redirect: "manual" });
}
async function exchangeAndList(clientId, redirectUri, code, verifier) {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, resource: `${BASE}/mcp` }),
  });
  assert.equal(res.status, 200, "token exchange");
  const pair = await res.json();
  const client = new Client({ name: "oauth-clients-e2e", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${pair.access_token}` } } }));
  const { tools } = await client.listTools();
  assert.equal(tools.length, 12);
  await client.close();
  const r = await fetch(`${BASE}/oauth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: pair.refresh_token, client_id: clientId }) });
  assert.equal(r.status, 200, "refresh");
}

async function flow(label, clientName, registered, used = registered[0]) {
  await check(`${label}: DCR -> approve -> code -> token -> tools/list -> refresh`, async () => {
    const reg = await register(clientName, registered);
    assert.equal(reg.status, 201, await reg.clone().text());
    const { client_id } = await reg.json();
    assert.ok(client_id.startsWith("mcpcl."));
    const { verifier, params } = authorizeParams(client_id, used);
    const page = await fetch(`${BASE}/oauth/authorize?${params}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes(clientName.replace(/[^\p{L}\p{N} ._()-]/gu, "")), "consent names the client");
    const res = await approve(params);
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get("location"));
    assert.equal(`${loc.protocol}//${loc.host}${loc.pathname}`, `${new URL(used).protocol}//${new URL(used).host}${new URL(used).pathname}`);
    assert.equal(loc.searchParams.get("state"), params.get("state"));
    await exchangeAndList(client_id, used, loc.searchParams.get("code"), verifier);
  });
}

await flow("Claude (claude.ai)", "Claude", ["https://claude.ai/api/mcp/auth_callback"]);
await flow("Claude (claude.com)", "Claude", ["https://claude.com/api/mcp/auth_callback"]);
await flow("ChatGPT", "ChatGPT", ["https://chatgpt.com/connector_platform_oauth_redirect"]);
await flow("Claude Code loopback, ephemeral port", "Claude Code", ["http://localhost/callback", "http://127.0.0.1/callback"], "http://localhost:51234/callback");
await flow("VS Code loopback", "Visual Studio Code", ["https://vscode.dev/redirect", "http://127.0.0.1/", "http://127.0.0.1:33418/"], "http://127.0.0.1:59656/");
await flow("Cursor custom scheme", "Cursor", ["cursor://anysphere.cursor-mcp/oauth/callback"]);

await check("Grok legacy fixed client_id still works", async () => {
  const redirect = "https://grok.com/connectors-oauth-exchange-code/";
  const { verifier, params } = authorizeParams("dypol-mcp-client", redirect);
  const res = await approve(params);
  assert.equal(res.status, 302);
  await exchangeAndList("dypol-mcp-client", redirect, new URL(res.headers.get("location")).searchParams.get("code"), verifier);
});

await check("bad redirects are rejected (DCR + authorize)", async () => {
  for (const uris of [["https://evil.example/cb"], ["https://claude.ai.evil.com/cb"], ["http://claude.ai/api/mcp/auth_callback"], ["javascript:alert(1)"], []]) {
    assert.equal((await register("x", uris)).status, 400, JSON.stringify(uris));
  }
  const reg = await (await register("Claude", ["https://claude.ai/api/mcp/auth_callback"])).json();
  const other = authorizeParams(reg.client_id, "https://chatgpt.com/connector_platform_oauth_redirect");
  const r1 = await fetch(`${BASE}/oauth/authorize?${other.params}`);
  assert.equal(r1.status, 400, "allowed host but not registered for this client");
  assert.match(await r1.text(), /not registered/);
  const tampered = authorizeParams(reg.client_id.slice(0, -1) + (reg.client_id.endsWith("0") ? "1" : "0"), "https://claude.ai/api/mcp/auth_callback");
  assert.equal((await fetch(`${BASE}/oauth/authorize?${tampered.params}`)).status, 400, "tampered client_id");
  const evil = authorizeParams("dypol-mcp-client", "https://evil.example/cb");
  assert.equal((await fetch(`${BASE}/oauth/authorize?${evil.params}`)).status, 400);
});

await check("wrong MCP token on a registered client: 401, no redirect", async () => {
  const reg = await (await register("ChatGPT", ["https://chatgpt.com/connector_platform_oauth_redirect"])).json();
  const { params } = authorizeParams(reg.client_id, "https://chatgpt.com/connector_platform_oauth_redirect");
  const res = await approve(params, "0".repeat(32));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("location"), null);
});

await check("CORS: claude.ai / chatgpt.com preflight allowed, evil origin refused", async () => {
  for (const origin of ["https://claude.ai", "https://chatgpt.com"]) {
    const r = await fetch(`${BASE}/mcp`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST" } });
    assert.equal(r.status, 204, origin);
    assert.equal(r.headers.get("access-control-allow-origin"), origin);
  }
  const bad = await fetch(`${BASE}/mcp`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
  assert.equal(bad.status, 403);
});

await check("browser: Claude-style Allow navigates to claude.ai callback (CSP form-action ok)", async () => {
  const reg = await (await register("Claude", ["https://claude.ai/api/mcp/auth_callback"])).json();
  const { params } = authorizeParams(reg.client_id, "https://claude.ai/api/mcp/auth_callback");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const csp = [];
    page.on("console", (m) => /Content Security Policy/i.test(m.text()) && csp.push(m.text()));
    // Redirect targets cannot be intercepted; record the navigation request instead.
    // (claude.ai receives one useless code: it cannot be redeemed without our PKCE verifier.)
    let hit = null;
    page.on("request", (r) => r.isNavigationRequest() && r.url().startsWith("https://claude.ai/api/mcp/auth_callback?") && (hit ??= r.url()));
    await page.goto(`${BASE}/oauth/authorize?${params}`);
    await page.fill("input[name=owner_secret]", TOKEN);
    await page.click("button[type=submit]");
    for (let i = 0; i < 50 && !hit; i += 1) await page.waitForTimeout(200);
    assert.ok(hit, "callback reached");
    assert.ok(new URL(hit).searchParams.get("code")?.startsWith("mcpac."));
    assert.deepEqual(csp, []);
  } finally {
    await browser.close();
  }
});

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall OAuth client checks passed");
