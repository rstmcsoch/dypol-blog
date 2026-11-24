import assert from "node:assert/strict";
import test from "node:test";
import { acceptPrefersSse, encodeSseMessage, rpcMethodOf } from "./transport.ts";

test("prefer JSON when the client advertises both JSON and event-stream; SSE only when JSON is absent", () => {
  assert.equal(acceptPrefersSse("application/json, text/event-stream"), false);
  assert.equal(acceptPrefersSse("text/event-stream"), true);
  assert.equal(acceptPrefersSse("text/event-stream, application/json"), false);
  assert.equal(acceptPrefersSse("application/json"), false);
  assert.equal(acceptPrefersSse(null), false);
});

test("SSE frames are event: message with JSON data and a blank line", () => {
  const frame = encodeSseMessage({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05" } });
  assert.equal(frame, 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05"}}\n\n');
  const batch = encodeSseMessage([{ jsonrpc: "2.0", id: 1, result: {} }, { jsonrpc: "2.0", id: 2, result: {} }]);
  assert.equal((batch.match(/^event: message$/gm) || []).length, 2);
});

test("rpcMethodOf identifies initialize, tools/list and tools/call without reading arguments", () => {
  assert.deepEqual(rpcMethodOf({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }), { method: "initialize" });
  assert.deepEqual(rpcMethodOf({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }), { method: "tools/list" });
  assert.deepEqual(rpcMethodOf({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create_article", arguments: { title: "secret-should-not-be-read-here" } } }), { method: "tools/call", toolName: "create_article" });
  assert.deepEqual(rpcMethodOf([{ jsonrpc: "2.0", id: 1, method: "ping" }]), { method: "batch" });
});

test("Wabi-MCP initialize body is 151 bytes and is not tools/list or tools/call", () => {
  const body = {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"Wabi","version":"1.0"}}};
  assert.equal(JSON.stringify(body).length, 151);
  assert.deepEqual(rpcMethodOf(body), { method: "initialize" });
});
