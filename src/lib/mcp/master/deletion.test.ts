import assert from "node:assert/strict";
import test from "node:test";
import { confirmationExpiresAt, confirmationValid, newConfirmationToken, stablePreview } from "./deletion.ts";

test("confirmation token is bound to the exact action and resource", () => {
  const token = newConfirmationToken();
  assert.match(token, /^cnf_[0-9a-f]{48}$/);
  const expiresAt = confirmationExpiresAt(1_700_000_000_000, 60_000);
  const stored = { action: "delete_article" as const, resourceId: "art-1", expiresAt };
  assert.deepEqual(confirmationValid({ stored, action: "delete_article", resourceId: "art-1", now: 1_700_000_000_000 }), { ok: true });
  assert.match((() => { const r = confirmationValid({ stored, action: "delete_page", resourceId: "art-1", now: 1_700_000_000_000 }); assert.equal(r.ok, false); return r.ok ? "" : r.error; })(), /different action/);
  assert.match((() => { const r = confirmationValid({ stored, action: "delete_article", resourceId: "art-2", now: 1_700_000_000_000 }); assert.equal(r.ok, false); return r.ok ? "" : r.error; })(), /different item/);
  assert.match((() => { const r = confirmationValid({ stored, action: "delete_article", resourceId: "art-1", now: 1_700_000_060_001 }); assert.equal(r.ok, false); return r.ok ? "" : r.error; })(), /expired/);
});

test("stable preview is key-order insensitive", () => {
  assert.equal(stablePreview({ b: 1, a: { d: 2, c: 3 } }), stablePreview({ a: { c: 3, d: 2 }, b: 1 }));
  assert.notEqual(stablePreview({ a: 1 }), stablePreview({ a: 2 }));
});
