import assert from "node:assert/strict";
import test from "node:test";
import {
  canAuthenticate,
  hashSecret,
  isMasterTokenShape,
  newMasterConnectionId,
  newMasterToken,
  parseMasterToken,
  secretVersion,
  tokenPrefix,
} from "./credentials.ts";

test("generated Master tokens parse and are distinct from profile tokens", async () => {
  const id = newMasterConnectionId();
  assert.match(id, /^m[0-9a-f]{8}$/);
  const token = newMasterToken(id);
  assert.equal(parseMasterToken(token)?.connectionId, id);
  assert.equal(isMasterTokenShape(token), true);
  assert.equal(isMasterTokenShape(`dyp_${id}_${"a".repeat(48)}`), false, "profile token shape is rejected");
  assert.equal(parseMasterToken("dyp_p00aabbcc_" + "a".repeat(48)), null);
  assert.equal(tokenPrefix(token), `dypm_${id}_…`);
  const hash = await hashSecret(token);
  assert.equal(hash.length, 64);
  assert.equal(await hashSecret(token), hash);
  assert.notEqual(await hashSecret(token + "x"), hash);
  assert.equal(secretVersion(hash).length, 12);
});

test("invalid connection ids cannot mint a token", () => {
  assert.throws(() => newMasterToken("default"));
  assert.throws(() => newMasterToken("p00aabbcc"));
});

test("only an active credential may authenticate", () => {
  assert.equal(canAuthenticate("active"), true);
  assert.equal(canAuthenticate("deactivated"), false);
  assert.equal(canAuthenticate("revoked"), false);
  assert.equal(canAuthenticate(null), false);
});
