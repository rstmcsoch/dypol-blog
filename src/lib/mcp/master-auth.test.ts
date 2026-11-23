import assert from "node:assert/strict";
import test from "node:test";
import { authenticate } from "./auth.ts";
import { hashSecret, newMasterConnectionId, newMasterToken } from "./master/credentials.ts";

const TOKEN = "t".repeat(40);

test("Master bearer authenticates with role master; MCP_TOKEN does not", async () => {
  const id = newMasterConnectionId();
  const token = newMasterToken(id);
  const hash = await hashSecret(token);
  const master = {
    async byToken(presented: string) {
      return (await hashSecret(presented)) === hash ? { id } : null;
    },
  };
  const ok = await authenticate(`Bearer ${token}`, TOKEN, undefined, undefined, master);
  assert.deepEqual(ok, { ok: true, via: "bearer", profile: { id: "master", version: "" }, role: "master", connectionId: id });

  const viaMcp = await authenticate(`Bearer ${TOKEN}`, TOKEN, undefined, undefined, master);
  assert.deepEqual(viaMcp, { ok: true, via: "bearer", profile: { id: "default", version: "" } });
  assert.equal("role" in viaMcp ? (viaMcp as { role?: string }).role : undefined, undefined);
});

test("Master bearer works even when MCP_TOKEN is unset; revoked or wrong keys fail", async () => {
  const id = newMasterConnectionId();
  const token = newMasterToken(id);
  const hash = await hashSecret(token);
  const master = {
    async byToken(presented: string) {
      return (await hashSecret(presented)) === hash ? { id } : null;
    },
  };
  const ok = await authenticate(`Bearer ${token}`, undefined, undefined, undefined, master);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.role, "master");
  assert.deepEqual(await authenticate(`Bearer ${newMasterToken(id)}`, TOKEN, undefined, undefined, master), { ok: false, reason: "invalid" });
  assert.deepEqual(await authenticate(`Bearer ${TOKEN}`, undefined), { ok: false, reason: "disabled" });
});

test("a publishing profile token never receives the Master role", async () => {
  const profiles = {
    async byToken() {
      return { id: "p00aabbcc", version: "abc" };
    },
    async stillValid() {
      return true;
    },
  };
  const result = await authenticate("Bearer dyp_p00aabbcc_" + "a".repeat(48), TOKEN, undefined, profiles);
  assert.deepEqual(result, { ok: true, via: "profile-token", profile: { id: "p00aabbcc", version: "abc" } });
});
