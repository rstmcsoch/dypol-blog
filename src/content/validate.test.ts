import assert from "node:assert/strict";
import test from "node:test";
import { isSafeHref, publishProblems, slugify } from "./rules.ts";

test("slugify keeps a url-safe slug", () => {
  assert.equal(slugify("Hard Edge Returns"), "hard-edge-returns");
  assert.equal(slugify("  "), "piece");
});

test("publish requires an excerpt and a body", () => {
  assert.equal(publishProblems({ excerpt: "", blocks: [{ type: "paragraph", text: "Hello" }] }), "Add an excerpt before publishing.");
  assert.equal(publishProblems({ excerpt: "Hello", blocks: [{ type: "paragraph", text: "   " }] }), "Add at least one block before publishing.");
  assert.equal(publishProblems({ excerpt: "Hello", blocks: [{ type: "paragraph", text: "Body" }] }), null);
});

test("links reject scripts and accept site paths", () => {
  assert.equal(isSafeHref("/articles"), true);
  assert.equal(isSafeHref("https://dypol.example/legal"), true);
  assert.equal(isSafeHref("javascript:alert(1)"), false);
  assert.equal(isSafeHref("//evil.example"), false);
});
