import assert from "node:assert/strict";
import test from "node:test";
import { authenticate, exchangeCode, issueCode, pkceS256, redirectAllowed, refresh, secretMatches } from "./auth.ts";
import { handleRpc, type ToolDefinition } from "./protocol.ts";

const TOKEN = "t".repeat(40);

test("bearer auth: exact MCP_TOKEN only; disabled when unset or short", async () => {
  assert.deepEqual(await authenticate(`Bearer ${TOKEN}`, TOKEN), { ok: true, via: "bearer" });
  assert.deepEqual(await authenticate(`bearer ${TOKEN}`, TOKEN), { ok: true, via: "bearer" });
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
  assert.deepEqual(await authenticate(`Bearer ${pair.access_token}`, TOKEN), { ok: true, via: "oauth" });
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
  assert.deepEqual(await authenticate(`Bearer ${TOKEN}`, stored), { ok: true, via: "bearer" });
  assert.equal(await secretMatches(TOKEN.slice(1), stored), false);
  assert.equal(await secretMatches(`${TOKEN}x`, stored), false);
  const verifier = "v".repeat(64);
  const code = await issueCode(stored, { clientId: "c", redirectUri: "https://grok.com/cb", challenge: await pkceS256(verifier) });
  const pair = await exchangeCode(TOKEN, { code, clientId: "c", redirectUri: "https://grok.com/cb", verifier });
  assert.ok(pair, "tokens minted under the stored value validate under the trimmed value");
});
