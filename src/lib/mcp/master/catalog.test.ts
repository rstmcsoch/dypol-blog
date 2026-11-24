import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { MASTER_PROHIBITED_TOOL_NAMES } from "./permissions.ts";
import { MASTER_TOOL_CATALOG, MASTER_TOOL_NAMES, PUBLISHER_TASK_TOOL_NAMES } from "./catalog.ts";

const tools = readFileSync(new URL("../master-tools.server.ts", import.meta.url), "utf8");
const pub = readFileSync(new URL("../tools.server.ts", import.meta.url), "utf8");
const http = readFileSync(new URL("../http.server.ts", import.meta.url), "utf8");
const auth = readFileSync(new URL("../auth.ts", import.meta.url), "utf8");

test("every catalogued Master tool is implemented exactly once", () => {
  assert.equal(new Set(MASTER_TOOL_NAMES).size, MASTER_TOOL_NAMES.length);
  for (const name of MASTER_TOOL_NAMES) {
    const matches = tools.split(`name: "${name}"`).length - 1;
    assert.equal(matches, 1, `${name} should be implemented once, found ${matches}`);
  }
  assert.equal(MASTER_TOOL_CATALOG.length, 54);
});

test("prohibited tool names are never implemented", () => {
  for (const name of MASTER_PROHIBITED_TOOL_NAMES) {
    assert.equal(tools.split(`name: "${name}"`).length - 1, 0, name);
    assert.ok(!MASTER_TOOL_NAMES.includes(name as never), name);
  }
});

test("ordinary publishing MCPs get task tools but not Master tools", () => {
  for (const name of PUBLISHER_TASK_TOOL_NAMES) {
    assert.match(pub, new RegExp(`name: "${name}"`));
  }
  assert.match(pub, /publisherTaskTools/);
  assert.doesNotMatch(pub, /name: "get_master_overview"/);
  assert.doesNotMatch(pub, /name: "execute_sql"/);
});

test("Master tools are only registered after Master-specific authentication", () => {
  assert.match(http, /auth\.role === "master"/);
  assert.match(http, /buildMasterTools/);
  assert.match(http, /masterResolver/);
  assert.match(auth, /role: "master"/);
  assert.match(auth, /presented\.startsWith\("dypm_"\)/);
  assert.match(http, /MCP_TOKEN/);
});
