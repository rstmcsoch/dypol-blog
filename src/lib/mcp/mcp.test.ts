import assert from "node:assert/strict";
import test from "node:test";
import { authenticate, exchangeCode, formActionSource, issueCode, pkceS256, readClient, redirectAllowed, redirectMatches, refresh, registerClient, secretMatches, adminRegisteredRedirectOk } from "./auth.ts";
import { handleRpc, type ToolDefinition } from "./protocol.ts";

const TOKEN = "t".repeat(40);

test("bearer auth: exact MCP_TOKEN only; disabled when unset or short", async () => {
  assert.deepEqual(await authenticate(`Bearer ${TOKEN}`, TOKEN), { ok: true, via: "bearer", profile: { id: "default", version: "" } });
  assert.deepEqual(await authenticate(`bearer ${TOKEN}`, TOKEN), { ok: true, via: "bearer", profile: { id: "default", version: "" } });
  assert.deepEqual(await authenticate(`Bearer ${TOKEN}x`, TOKEN), { ok: false, reason: "invalid" });
  assert.deepEqual(await authenticate(null, TOKEN), { ok: false, reason: "missing" });
  assert.deepEqual(await authenticate(`Basic ${TOKEN}`, TOKEN), { ok: false, reason: "missing" });
  assert.deepEqual(await authenticate(`Bearer ${TOKEN}`, undefined), { ok: false, reason: "disabled" });
  assert.deepEqual(await authenticate(`Bearer short`, "short"), { ok: false, reason: "disabled" });
  assert.equal(await secretMatches("", TOKEN), false);
});

test("OAuth: PKCE code exchange, token use, refresh, rotation revokes", async () => {
  const verifier = "v".repeat(64);
  const challenge = await pkceS256(verifier);
  const redirectUri = "https://grok.com/connectors/callback";
  const code = await issueCode(TOKEN, { clientId: "c1", redirectUri, challenge });
  assert.equal(await exchangeCode(TOKEN, { code, clientId: "c1", redirectUri, verifier: "w".repeat(64) }), null, "wrong verifier");
  assert.equal(await exchangeCode(TOKEN, { code, clientId: "c2", redirectUri, verifier }), null, "wrong client");
  assert.equal(await exchangeCode(TOKEN, { code, clientId: "c1", redirectUri: "https://grok.com/other", verifier }), null, "wrong redirect");
  const pair = await exchangeCode(TOKEN, { code, clientId: "c1", redirectUri, verifier });
  assert.ok(pair);
  assert.deepEqual(await authenticate(`Bearer ${pair.access_token}`, TOKEN), { ok: true, via: "oauth", client: "legacy connector", profile: { id: "default", version: "" } });
  assert.deepEqual(await authenticate(`Bearer ${pair.access_token}`, "r".repeat(40)), { ok: false, reason: "invalid" }, "rotated MCP_TOKEN");
  const later = Math.floor(Date.now() / 1000) + 3601;
  assert.deepEqual(await authenticate(`Bearer ${pair.access_token}`, TOKEN, later), { ok: false, reason: "invalid" }, "expired");
  assert.ok(await refresh(TOKEN, { refreshToken: pair.refresh_token, clientId: "c1" }));
  assert.equal(await refresh(TOKEN, { refreshToken: pair.refresh_token, clientId: "c2" }), null);
  assert.equal(await refresh(TOKEN, { refreshToken: pair.access_token, clientId: "c1" }), null, "access token is not a refresh token");
  assert.equal(await exchangeCode(TOKEN, { code, clientId: "c1", redirectUri, verifier }, later), null, "code expired");
  assert.deepEqual(await authenticate(`Bearer ${code}`, TOKEN), { ok: false, reason: "invalid" }, "a code is not a token");
});

test("OAuth redirect allow-list", () => {
  assert.equal(redirectAllowed("https://grok.com/cb"), true);
  assert.equal(redirectAllowed("https://auth.x.ai/cb"), true);
  assert.equal(redirectAllowed("http://127.0.0.1:5000/cb"), true);
  assert.equal(redirectAllowed("https://evil.com/cb"), false);
  assert.equal(redirectAllowed("https://grok.com.evil.com/cb"), false);
  assert.equal(redirectAllowed("http://grok.com/cb"), false);
  assert.equal(redirectAllowed("https://my.host/cb", "my.host"), true);
  assert.equal(redirectAllowed("javascript:alert(1)"), false);
  // Well-known MCP clients
  for (const uri of [
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
    "https://chatgpt.com/connector_platform_oauth_redirect",
    "https://chatgpt.com/connector/oauth/abc123",
    "https://www.cursor.com/agents/mcp/oauth/callback",
    "https://vscode.dev/redirect",
    "https://insiders.vscode.dev/redirect",
    "http://localhost:8787/callback",
    "http://127.0.0.1:33418/",
    "http://[::1]:7777/oauth/callback",
    "cursor://anysphere.cursor-mcp/oauth/callback",
    "https://oauth-redirect.googleusercontent.com/r/example",
    "https://oauth-redirect-sandbox.googleusercontent.com/a/example",
    "https://vertexaisearch.cloud.google.com/oauth-redirect",
    "https://gemini.google.com/callback",
  ]) assert.equal(redirectAllowed(uri), true, uri);
  for (const uri of ["https://claude.ai.evil.com/cb", "http://claude.ai/api/mcp/auth_callback", "cursor://evil/cb", "vscode-evil://x", "https://u:p@claude.ai/cb", "https://claude.ai/cb#f", "data:text/html,x", "https://evil.googleusercontent.com/r/x", "https://oauth-redirect.googleusercontent.com.evil.com/r/x", "https://storage.googleapis.com/bucket"]) {
    assert.equal(redirectAllowed(uri), false, uri);
  }
  assert.equal(redirectAllowed("https://a.my.host/cb", ["my.host"]), true);
  assert.equal(redirectAllowed("https://a.my.host/cb", ["https://bad"]), false);
  assert.equal(adminRegisteredRedirectOk("https://oauth-redirect.googleusercontent.com/r/abc"), true);
  assert.equal(adminRegisteredRedirectOk("https://connectors.example.com/cb"), true);
  assert.equal(adminRegisteredRedirectOk("http://127.0.0.1:9/cb"), true);
  assert.equal(adminRegisteredRedirectOk("http://evil.example/cb"), false);
  assert.equal(adminRegisteredRedirectOk("javascript:alert(1)"), false);
  assert.equal(adminRegisteredRedirectOk("https://user:pass@claude.ai/cb"), false);
});

test("loopback redirects match on any port; others exact", () => {
  assert.equal(redirectMatches("http://127.0.0.1/", "http://127.0.0.1:59656/"), true);
  assert.equal(redirectMatches("http://localhost/callback", "http://localhost:44770/callback"), true);
  assert.equal(redirectMatches("http://localhost/callback", "http://localhost:1/other"), false);
  assert.equal(redirectMatches("http://localhost/callback", "http://127.0.0.1:1/callback"), false);
  assert.equal(redirectMatches("https://claude.ai/api/mcp/auth_callback", "https://claude.ai/api/mcp/auth_callback"), true);
  assert.equal(redirectMatches("https://claude.ai/api/mcp/auth_callback", "https://claude.ai/api/mcp/other"), false);
  assert.equal(formActionSource("cursor://anysphere.cursor-mcp/oauth/callback"), "cursor:");
  assert.equal(formActionSource("https://claude.ai/x"), "https://claude.ai");
});

test("DCR: signed client ids carry name + redirects; tampering and rotation void them; tokens carry client name", async () => {
  const id = await registerClient(TOKEN, { name: "Claude <script>", redirectUris: ["https://claude.ai/api/mcp/auth_callback"] });
  assert.deepEqual(await readClient(TOKEN, id), { name: "Claude script", redirectUris: ["https://claude.ai/api/mcp/auth_callback"] });
  assert.equal(await readClient("r".repeat(40), id), null, "rotated MCP_TOKEN");
  assert.equal(await readClient(TOKEN, id.replace(/.$/, (c) => (c === "0" ? "1" : "0"))), null, "tampered");
  assert.equal(await readClient(TOKEN, "dypol-mcp-client"), null, "legacy id is not signed");
  const verifier = "v".repeat(64);
  const redirectUri = "https://claude.ai/api/mcp/auth_callback";
  const code = await issueCode(TOKEN, { clientId: id, redirectUri, challenge: await pkceS256(verifier) });
  const pair = await exchangeCode(TOKEN, { code, clientId: id, redirectUri, verifier });
  assert.ok(pair);
  assert.deepEqual(await authenticate(`Bearer ${pair.access_token}`, TOKEN), { ok: true, via: "oauth", client: "Claude script", profile: { id: "default", version: "" } });
  assert.ok(await refresh(TOKEN, { refreshToken: pair.refresh_token, clientId: id }));
});

test("confidential OAuth: access is revoked when the client secret version no longer matches", async () => {
  const verifier = "v".repeat(64);
  const redirectUri = "https://oauth-redirect.googleusercontent.com/r/gemini";
  const version = "abc123abc123";
  const code = await issueCode(TOKEN, { clientId: "dypc_" + "ab".repeat(16), redirectUri, challenge: await pkceS256(verifier), oauthClientVersion: version });
  const pair = await exchangeCode(TOKEN, { code, clientId: "dypc_" + "ab".repeat(16), redirectUri, verifier });
  assert.ok(pair);
  const ok = {
    byToken: async () => null,
    stillValid: async () => false,
    oauthClientStillValid: async (id: string, v: string) => id === "default" && v === version,
  };
  assert.equal((await authenticate(`Bearer ${pair.access_token}`, TOKEN, undefined, ok)).ok, true);
  const revoked = { ...ok, oauthClientStillValid: async () => false };
  assert.deepEqual(await authenticate(`Bearer ${pair.access_token}`, TOKEN, undefined, revoked), { ok: false, reason: "invalid" });
  assert.equal(await refresh(TOKEN, { refreshToken: pair.refresh_token, clientId: "dypc_" + "ab".repeat(16) }, undefined, revoked), null);
  assert.equal((await authenticate(`Bearer ${pair.access_token}`, TOKEN)).ok, false, "missing resolver rejects confidential tokens");
});

const echo: ToolDefinition = {
  name: "echo",
  title: "Echo",
  description: "echo",
  inputSchema: { type: "object" },
  run: async (args) => ({ ok: true, data: args }),
};
const boom: ToolDefinition = { ...echo, name: "boom", run: async () => { throw new Error("secret detail"); } };

test("JSON-RPC: initialize, list, call, errors, notifications", async () => {
  const init = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, [echo])) as { result: { protocolVersion: string; capabilities: object } };
  assert.equal(init.result.protocolVersion, "2025-03-26");
  const unknownVersion = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999" } }, [])) as { result: { protocolVersion: string } };
  assert.equal(unknownVersion.result.protocolVersion, "2025-06-18");
  assert.equal(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, []), null);
  const list = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, [echo])) as { result: { tools: { name: string }[] } };
  assert.deepEqual(list.result.tools.map((t) => t.name), ["echo"]);
  const call = (await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { a: 1 } } }, [echo])) as { result: { isError: boolean; structuredContent: unknown } };
  assert.deepEqual(call.result, { content: [{ type: "text", text: JSON.stringify({ a: 1 }, null, 2) }], structuredContent: { a: 1 }, isError: false });
  const failed = (await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "boom" } }, [boom])) as { result: { isError: boolean; content: { text: string }[] } };
  assert.equal(failed.result.isError, true);
  assert.doesNotMatch(failed.result.content[0].text, /secret detail/);
  assert.equal(((await handleRpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } }, [])) as { error: { code: number } }).error.code, -32602);
  assert.equal(((await handleRpc({ jsonrpc: "2.0", id: 6, method: "resources/list" }, [])) as { error: { code: number } }).error.code, -32601);
  assert.equal(((await handleRpc({ id: 7 }, [])) as { error: { code: number } }).error.code, -32600);
  assert.equal(((await handleRpc([], [])) as { error: { code: number } }).error.code, -32600);
});

test("regression: stored secret with surrounding whitespace still matches the pasted token (approval page + bearer)", async () => {
  const stored = `${TOKEN}\n`;
  assert.equal(await secretMatches(TOKEN, stored), true);
  assert.equal(await secretMatches(` ${TOKEN} `, TOKEN), true);
  assert.deepEqual(await authenticate(`Bearer ${TOKEN}`, stored), { ok: true, via: "bearer", profile: { id: "default", version: "" } });
  assert.equal(await secretMatches(TOKEN.slice(1), stored), false);
  assert.equal(await secretMatches(`${TOKEN}x`, stored), false);
  const verifier = "v".repeat(64);
  const code = await issueCode(stored, { clientId: "c", redirectUri: "https://grok.com/cb", challenge: await pkceS256(verifier) });
  const pair = await exchangeCode(TOKEN, { code, clientId: "c", redirectUri: "https://grok.com/cb", verifier });
  assert.ok(pair, "tokens minted under the stored value validate under the trimmed value");
});

test("CORS origin allow-list for browser-originated MCP requests", async () => {
  const { originAllowed } = await import("./cors.ts");
  const self = "https://grok-mcp-automation-dypolblog.rstmcsoch.workers.dev";
  assert.equal(originAllowed(self, self), true);
  assert.equal(originAllowed("https://grok.com", self), true);
  assert.equal(originAllowed("https://www.grok.com", self), true);
  assert.equal(originAllowed("https://console.x.ai", self), true);
  assert.equal(originAllowed("http://grok.com", self), false);
  assert.equal(originAllowed("https://grok.com.evil.com", self), false);
  assert.equal(originAllowed("https://evil.example", self), false);
  assert.equal(originAllowed("null", self), false);
  assert.equal(originAllowed("https://my.host", self, "my.host"), true);
  assert.equal(originAllowed("https://claude.ai", self), true);
  assert.equal(originAllowed("https://chatgpt.com", self), true);
  assert.equal(originAllowed("https://claude.ai.evil.com", self), false);
});

test("profile tokens: resolver binds profile; revoked/replaced profile voids its OAuth tokens", async () => {
  const { authenticate: auth, issueCode, exchangeCode, refresh, pkceS256 } = await import("./auth.ts");
  let version = "v1";
  const resolver = {
    byToken: async (t: string) => (t === "dyp_p0000abcd_" + "a".repeat(48) ? { id: "p0000abcd", version } : null),
    stillValid: async (b: { id: string; version: string }) => b.id === "p0000abcd" && b.version === version,
  };
  const good = "dyp_p0000abcd_" + "a".repeat(48);
  assert.deepEqual(await auth(`Bearer ${good}`, TOKEN, undefined, resolver), { ok: true, via: "profile-token", profile: { id: "p0000abcd", version: "v1" } });
  assert.deepEqual(await auth(`Bearer dyp_p0000abcd_${"b".repeat(48)}`, TOKEN, undefined, resolver), { ok: false, reason: "invalid" });
  const verifier = "v".repeat(50);
  const code = await issueCode(TOKEN, { clientId: "dypol-mcp-client", redirectUri: "https://grok.com/cb", challenge: await pkceS256(verifier), profile: { id: "p0000abcd", version: "v1" } });
  const pair = await exchangeCode(TOKEN, { code, clientId: "dypol-mcp-client", redirectUri: "https://grok.com/cb", verifier });
  assert.ok(pair);
  const a = await auth(`Bearer ${pair.access_token}`, TOKEN, undefined, resolver);
  assert.equal(a.ok && a.profile.id, "p0000abcd");
  version = "v2"; // token replaced or revoked
  assert.deepEqual(await auth(`Bearer ${pair.access_token}`, TOKEN, undefined, resolver), { ok: false, reason: "invalid" });
  assert.equal(await refresh(TOKEN, { refreshToken: pair.refresh_token, clientId: "dypol-mcp-client" }, undefined, resolver), null);
});
