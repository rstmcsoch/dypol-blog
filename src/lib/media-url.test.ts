import assert from "node:assert/strict";
import { test } from "node:test";
import { mediaUrl, thumbUrl } from "./media-url.ts";

test("hero is the bare media URL (unchanged from before)", () => {
  assert.equal(mediaUrl("abc-123"), "/media/abc-123");
  assert.equal(mediaUrl("abc-123", "hero"), "/media/abc-123");
});

test("thumb requests the thumbnail variant", () => {
  assert.equal(mediaUrl("abc-123", "thumb"), "/media/abc-123?variant=thumb");
  assert.equal(thumbUrl("abc-123"), "/media/abc-123?variant=thumb");
});
