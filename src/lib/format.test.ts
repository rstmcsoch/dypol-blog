import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDate, isMeaningfullyUpdated } from "./format.ts";

test("isMeaningfullyUpdated only fires for a real later edit", () => {
  assert.equal(isMeaningfullyUpdated("2026-10-18T08:00:00Z", "2026-10-18T08:00:00Z"), false);
  assert.equal(isMeaningfullyUpdated("2026-10-18T08:00:00Z", "2026-10-18T08:00:30Z"), false);
  assert.equal(isMeaningfullyUpdated("2026-10-18T08:00:00Z", "2026-10-19T08:00:00Z"), true);
  assert.equal(isMeaningfullyUpdated(null, "2026-10-19T08:00:00Z"), false);
  assert.equal(isMeaningfullyUpdated("junk", "2026-10-19T08:00:00Z"), false);
  assert.match(formatDate("2026-10-18T08:00:00Z"), /18 Oct 2026/);
});
