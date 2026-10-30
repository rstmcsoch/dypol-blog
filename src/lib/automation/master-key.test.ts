import { test } from "node:test";
import assert from "node:assert/strict";
import { masterBearerAllowed, newMasterToken } from "./master-key.ts";

const empty = { superseded: false, hash: null as string | null };
const desk = { superseded: false, hash: "ab".repeat(32) };
const replaced = { superseded: true, hash: "ab".repeat(32) };
const revoked = { superseded: true, hash: null };

test("master bearer: Cloudflare secret works until the desk replaces or revokes it", () => {
  assert.equal(masterBearerAllowed(true, false, empty), true, "env secret");
  assert.equal(masterBearerAllowed(false, false, empty), false);
  assert.equal(masterBearerAllowed(false, true, desk), true, "desk key before any revoke flag");
  assert.equal(masterBearerAllowed(true, true, replaced), true, "new desk key");
  assert.equal(masterBearerAllowed(true, false, replaced), false, "old Cloudflare secret rejected");
  assert.equal(masterBearerAllowed(false, false, replaced), false);
  assert.equal(masterBearerAllowed(true, true, revoked), false, "revoke kills env and desk");
  assert.equal(masterBearerAllowed(false, true, { superseded: true, hash: null }), false, "hash flag without a hash");
});

test("master tokens are 64 hex chars and not profile tokens", () => {
  const token = newMasterToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(token.startsWith("dyp_"), false);
  assert.notEqual(newMasterToken(), token);
});
