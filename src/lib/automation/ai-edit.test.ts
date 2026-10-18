import assert from "node:assert/strict";
import test from "node:test";
import { assertAiCanAccess, assertAiPatchAllowed } from "./ai-edit.ts";
import { blocksToBody, bodyToBlocks } from "./body.ts";

const master = { profileId: "default", isMaster: true, editAllDrafts: false };
const profA = { profileId: "pa", isMaster: false, editAllDrafts: false };
const profAOpen = { profileId: "pa", isMaster: false, editAllDrafts: true };
const draft = { status: "draft" as const, slug: "d1" };
const publishedLocked = { status: "published" as const, slug: "p1", aiEditAllowed: false };
const publishedGrant = { status: "published" as const, slug: "p1", aiEditAllowed: true };

test("drafts: own profile and master may edit; other profiles refused", () => {
  assert.deepEqual(assertAiCanAccess(draft, "pa", profA, "edit"), { viaGrant: false });
  assert.deepEqual(assertAiCanAccess(draft, "pb", master, "edit"), { viaGrant: false });
  assert.throws(() => assertAiCanAccess(draft, "pb", profA, "edit"), /different automation profile/);
  assert.deepEqual(assertAiCanAccess(draft, "pb", profAOpen, "edit"), { viaGrant: false });
});

test("owner-created drafts: master only, unless edit-all is on", () => {
  assert.deepEqual(assertAiCanAccess(draft, null, master, "read"), { viaGrant: false });
  assert.throws(() => assertAiCanAccess(draft, null, profA, "read"), /created by the owner/);
  assert.deepEqual(assertAiCanAccess(draft, null, profAOpen, "read"), { viaGrant: false });
});

test("published: locked without grant for every action", () => {
  for (const action of ["read", "edit", "cover", "delete"] as const) {
    assert.throws(() => assertAiCanAccess(publishedLocked, "pa", profA, action), /published articles are locked/);
    assert.throws(() => assertAiCanAccess(publishedLocked, "pa", master, action), /published articles are locked/);
  }
});

test("published with grant: edit/cover/read allowed, delete and slug change refused", () => {
  assert.deepEqual(assertAiCanAccess(publishedGrant, "pa", profA, "edit"), { viaGrant: true });
  assert.deepEqual(assertAiCanAccess(publishedGrant, "pb", master, "cover"), { viaGrant: true });
  assert.throws(() => assertAiCanAccess(publishedGrant, "pa", profA, "delete"), /cannot delete a published article/);
  assertAiPatchAllowed(publishedGrant, { slug: "p1" }, true);
  assert.throws(() => assertAiPatchAllowed(publishedGrant, { slug: "renamed" }, true), /slug of a published article/);
  // Drafts may change slug freely.
  assertAiPatchAllowed(draft, { slug: "renamed" }, false);
});

test("publish action: drafts follow ownership; published always refused, grant or not", () => {
  assert.deepEqual(assertAiCanAccess(draft, "pa", profA, "publish"), { viaGrant: false });
  assert.deepEqual(assertAiCanAccess({ status: "unpublished", slug: "u1" }, "pb", master, "publish"), { viaGrant: false });
  assert.throws(() => assertAiCanAccess(draft, "pb", profA, "publish"), /different automation profile/);
  assert.throws(() => assertAiCanAccess(publishedLocked, "pa", profA, "publish"), /already published/);
  assert.throws(() => assertAiCanAccess(publishedGrant, "pa", profA, "publish"), /already published/);
});

test("unpublished behaves like draft", () => {
  assert.deepEqual(assertAiCanAccess({ status: "unpublished", slug: "u1" }, "pa", profA, "delete"), { viaGrant: false });
});

test("body round-trip: blocksToBody(bodyToBlocks(x)) preserves structure", () => {
  const body = "Intro paragraph.\n\n## Section\n\n- one\n- two\n\n> a quote\n\n```ts\nconst x = 1;\n```";
  assert.equal(blocksToBody(bodyToBlocks(body)), body);
});
