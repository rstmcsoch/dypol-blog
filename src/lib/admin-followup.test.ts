import assert from "node:assert/strict";
import test from "node:test";
import { buildRestoreInput, mergeActivityFeed, sanitizeNotFoundPath, type RevisionSnapshot } from "./admin-followup.ts";

test("sanitizeNotFoundPath: strips query, rejects junk", () => {
  assert.equal(sanitizeNotFoundPath("/old-post?utm=1"), "/old-post");
  assert.equal(sanitizeNotFoundPath("/a#frag"), "/a");
  assert.equal(sanitizeNotFoundPath("https://evil.example/x"), null);
  assert.equal(sanitizeNotFoundPath(""), null);
  assert.equal(sanitizeNotFoundPath(42), null);
  assert.equal(sanitizeNotFoundPath("/api/not-found"), null);
});

test("mergeActivityFeed: newest first, capped, sources labelled", () => {
  const out = mergeActivityFeed(
    [{ at: "2026-10-18T10:00:00Z", text: "Saved article x" }],
    [
      { at: "2026-10-18T11:00:00Z", text: "auto run" },
      { at: "2026-10-18T09:00:00Z", text: "older run" },
    ],
    2,
  );
  assert.equal(out.length, 2);
  assert.equal(out[0]?.source, "Automation");
  assert.equal(out[1]?.source, "You");
});

test("buildRestoreInput: keeps current slug/id, restores content, no publish intent", () => {
  const snap: RevisionSnapshot = {
    v: 1, title: "Old title", excerpt: "Old excerpt", categoryId: "tech", topicIds: ["tech"],
    tagIds: ["nvidia"], motif: "signal-grid", featured: false, seoTitle: "", seoDescription: "",
    coverMediaId: "", blocks: [{ type: "paragraph", text: "old" }], scheduledAt: null,
  };
  const input = buildRestoreInput("art-1", "current-slug", snap);
  assert.equal(input.id, "art-1");
  assert.equal(input.slug, "current-slug");
  assert.equal(input.title, "Old title");
  assert.equal("intent" in input, false);
  assert.deepEqual(input.blocks, [{ type: "paragraph", text: "old" }]);
});
