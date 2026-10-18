#!/usr/bin/env node
/**
 * Browser regression for the OAuth approval page: a real Chromium opens
 * /oauth/authorize with Grok's parameters, types MCP_TOKEN, clicks Allow and
 * must land on the redirect_uri with ?code&state (CSP form-action must permit
 * the redirect). Then exchanges the code (PKCE) and lists MCP tools.
 *
 *   BASE=<site> MCP_TOKEN=<token> node scripts/e2e/oauth-browser.e2e.mjs
 * Needs `npm i --no-save playwright @modelcontextprotocol/sdk` + chromium-headless-shell.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const TOKEN = process.env.MCP_TOKEN ?? "";
const REDIRECT = "https://grok.com/connectors-oauth-exchange-code/";
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

const verifier = randomBytes(48).toString("base64url");
const params = new URLSearchParams({
  response_type: "code",
  client_id: "dypol-mcp-client",
  redirect_uri: REDIRECT,
  state: "e2e-state",
  code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  code_challenge_method: "S256",
  resource: `${BASE}/mcp`,
  scope: "blog:automation",
});

const browser = await chromium.launch();
const context = await browser.newContext();
let callback = null;
// Playwright cannot intercept redirect targets, so we stop at "commit" of the
// navigation to grok.com and read the code from the URL. The code is useless to
// anyone without our PKCE verifier.
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

await check("wrong token: page re-renders with a visible error, no redirect", async () => {
  await page.goto(`${BASE}/oauth/authorize?${params}`);
  await page.fill("input[name=owner_secret]", "0".repeat(32));
  await Promise.all([page.waitForLoadState("load"), page.click("button[type=submit]")]);
  await page.getByText("That token is not right.").waitFor({ timeout: 5000 });
  assert.equal(callback, null);
});

await check("Allow with MCP_TOKEN navigates to the redirect_uri with code + state (no CSP block)", async () => {
  consoleErrors.length = 0;
  await page.goto(`${BASE}/oauth/authorize?${params}`);
  await page.fill("input[name=owner_secret]", TOKEN);
  await page.click("button[type=submit]");
  await page.waitForURL(/^https:\/\/grok\.com\/connectors-oauth-exchange-code/, { timeout: 10000, waitUntil: "commit" });
  callback = new URL(page.url());
  assert.ok(callback, "redirect_uri reached");
  assert.equal(callback.origin + callback.pathname.replace(/\/?$/, "/"), REDIRECT);
  assert.equal(callback.searchParams.get("state"), "e2e-state");
  assert.ok(callback.searchParams.get("code")?.startsWith("mcpac."));
  assert.deepEqual(consoleErrors.filter((e) => /Content Security Policy/i.test(e)), []);
});
await browser.close();

await check("code -> token (PKCE) -> MCP tools/list", async () => {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", code: callback.searchParams.get("code"), client_id: "dypol-mcp-client", redirect_uri: REDIRECT, code_verifier: verifier, resource: `${BASE}/mcp` }),
  });
  assert.equal(res.status, 200);
  const { access_token } = await res.json();
  const client = new Client({ name: "oauth-browser-e2e", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${access_token}` } } }));
  const { tools } = await client.listTools();
  assert.equal(tools.length, 12);
  await client.close();
});

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall OAuth browser checks passed");
