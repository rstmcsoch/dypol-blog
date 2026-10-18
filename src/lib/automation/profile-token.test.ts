import { test } from "node:test";
import assert from "node:assert/strict";
import { hashToken, newProfileId, newProfileToken, parseProfileToken, PROFILE_ID_RE, tokenVersion } from "./profile-token.ts";

test("profile ids and tokens round-trip; only a hash is derived", async () => {
  const id = newProfileId();
  assert.match(id, PROFILE_ID_RE);
  const token = newProfileToken(id);
  assert.deepEqual(parseProfileToken(token), { profileId: id });
  assert.deepEqual(parseProfileToken(`  ${token}\n`), { profileId: id });
  assert.equal(parseProfileToken("dyp_default_abc"), null);
  assert.equal(parseProfileToken(token.slice(0, -1)), null);
  const h = await hashToken(token);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, await hashToken(newProfileToken(id)));
  assert.equal(tokenVersion(h).length, 12);
});
