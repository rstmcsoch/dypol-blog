import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MASTER_PERMISSIONS,
  MASTER_LOCKED_PERMISSIONS,
  MASTER_TOGGLEABLE_PERMISSIONS,
  normalizeMasterPermissions,
  permissionForTool,
} from "./permissions.ts";
import { MASTER_TOOL_CATALOG } from "./catalog.ts";

test("normalizeMasterPermissions defaults all controllable areas to true and ignores locked/unknown keys", () => {
  const normalized = normalizeMasterPermissions({
    analytics: false,
    ads: false,
    security: true,
    infrastructure: true,
    unknown: false,
  });
  assert.equal(normalized.analytics, false);
  assert.equal(normalized.ads, false);
  assert.equal(normalized.content, true);
  assert.equal(normalized.publishing, true);
  assert.equal(normalized.automation, true);
  assert.equal(normalized.config, true);
  assert.equal(normalized.media, true);
  assert.equal(Object.keys(normalized).length, MASTER_TOGGLEABLE_PERMISSIONS.length);
  assert.equal(MASTER_LOCKED_PERMISSIONS.length, 3);
  assert.deepEqual(normalizeMasterPermissions(null), DEFAULT_MASTER_PERMISSIONS);
});

test("every non-system Master tool maps to a valid toggleable permission area", () => {
  const validKeys = new Set(MASTER_TOGGLEABLE_PERMISSIONS.map((p) => p.key));
  for (const entry of MASTER_TOOL_CATALOG) {
    if (entry.group === "system" && entry.name !== "get_daily_publishing_report") {
      assert.equal(permissionForTool(entry.name), null, `system tool ${entry.name} should stay readable`);
      continue;
    }
    const perm = permissionForTool(entry.name);
    assert.ok(perm && validKeys.has(perm), `tool ${entry.name} must map to a valid toggleable permission`);
  }
});
