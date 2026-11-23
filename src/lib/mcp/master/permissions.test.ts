import assert from "node:assert/strict";
import test from "node:test";
import {
  denyMaster,
  isMasterDenied,
  isReservedMasterId,
  looksLikeSecretLeak,
  MASTER_PERMISSION_SUMMARY,
  MASTER_PROHIBITED,
  MASTER_PROHIBITED_TOOL_NAMES,
  MASTER_RESERVED_ID,
  MasterDenied,
} from "./permissions.ts";

test("permission summary covers the backend-enforced areas", () => {
  const areas = MASTER_PERMISSION_SUMMARY.map((i) => i.area);
  for (const need of [
    "Content management",
    "Publishing management",
    "AI automation supervision",
    "Analytics",
    "Website configuration",
    "Media management",
    "Ads management",
    "Security and administrator management",
    "Website and infrastructure deletion",
    "Automation profile and credential lifecycle",
  ]) assert.ok(areas.includes(need), need);
  const security = MASTER_PERMISSION_SUMMARY.find((i) => i.area.startsWith("Security"));
  assert.equal(security?.level, "Restricted");
  const creds = MASTER_PERMISSION_SUMMARY.find((i) => i.area.startsWith("Automation profile"));
  assert.equal(creds?.level, "Owner only");
  const config = MASTER_PERMISSION_SUMMARY.find((i) => i.area === "Website configuration");
  assert.match(config?.level ?? "", /excluding protected executable code/);
});

test("every prohibited operation explains why it is rejected", () => {
  for (const [op, message] of Object.entries(MASTER_PROHIBITED)) {
    assert.ok(message.length > 40, op);
    assert.match(message, /owner|cannot|not permitted|owner-only/i, op);
    try {
      denyMaster(op);
      assert.fail("should throw");
    } catch (error) {
      assert.ok(isMasterDenied(error));
      assert.equal((error as MasterDenied).operation, op);
      assert.equal((error as Error).message, message);
    }
  }
});

test("arbitrary SQL / JS tool names are on the denylist", () => {
  for (const name of ["execute_sql", "run_admin_function", "execute_javascript"]) {
    assert.ok((MASTER_PROHIBITED_TOOL_NAMES as readonly string[]).includes(name), name);
  }
});

test("reserved master id is distinct from publishing profiles", () => {
  assert.equal(MASTER_RESERVED_ID, "master");
  assert.equal(isReservedMasterId("master"), true);
  assert.equal(isReservedMasterId("MASTER"), true);
  assert.equal(isReservedMasterId("default"), false);
  assert.equal(isReservedMasterId("p00aabbcc"), false);
});

test("secret leak detector requires a value assignment, not a mention", () => {
  assert.equal(looksLikeSecretLeak("The Master MCP cannot access ADMIN_TOKEN."), false);
  assert.equal(looksLikeSecretLeak("ADMIN_TOKEN=supersecret"), true);
  assert.equal(looksLikeSecretLeak("MCP_TOKEN: abcdef"), true);
});
