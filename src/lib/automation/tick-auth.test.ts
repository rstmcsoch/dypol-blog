import assert from "node:assert/strict";
import test from "node:test";
import { tickAuthorised, tickConfigured } from "./tick-auth.ts";

const CRON = "c".repeat(40);
const MCP = "m".repeat(40);
const env = { CRON_SECRET: CRON, MCP_TOKEN: MCP };

test("the tick endpoint fails closed when no secret is configured", () => {
  assert.equal(tickConfigured({}), false);
  assert.equal(tickConfigured({ CRON_SECRET: "short" }), false);
  assert.equal(tickConfigured({ MCP_TOKEN: "short" }), false);
  assert.equal(tickConfigured({ CRON_SECRET: "c".repeat(16) }), true);
  assert.equal(tickConfigured({ MCP_TOKEN: "m".repeat(32) }), true);
});

test("a bearer token is accepted for either configured secret, and nothing else", async () => {
  assert.equal(await tickAuthorised(`Bearer ${CRON}`, env), "cron");
  assert.equal(await tickAuthorised(`bearer ${MCP}`, env), "mcp");
  assert.equal(await tickAuthorised(`Bearer ${CRON}x`, env), null);
  assert.equal(await tickAuthorised("Basic abc", env), null);
  assert.equal(await tickAuthorised(null, env), null);
  assert.equal(await tickAuthorised("Bearer ", env), null);
  assert.equal(await tickAuthorised(`Bearer ${"z".repeat(40)}`, env), null);
  // A short MCP_TOKEN can never authorise, even if it matches.
  assert.equal(await tickAuthorised("Bearer short", { MCP_TOKEN: "short" }), null);
});
