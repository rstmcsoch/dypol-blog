import assert from "node:assert/strict";
import test from "node:test";
import { checklistScore, seoChecklist } from "./seo-checklist.ts";

const ready = {
  title: "A clear headline for readers",
  seoTitle: "",
  seoDescription: "x".repeat(140),
  excerpt: "y".repeat(80),
  slug: "clear-headline",
  coverMediaId: "media-1",
  topicCount: 2,
  words: 900,
  hasHeading: true,
};

test("seo checklist: a complete article passes everything", () => {
  const items = seoChecklist(ready);
  assert.deepEqual(checklistScore(items), { passed: items.length, total: items.length });
});

test("seo checklist: gaps are flagged with hints", () => {
  const items = seoChecklist({ ...ready, seoDescription: "", coverMediaId: null, words: 120, hasHeading: false, topicCount: 6, slug: "Bad Slug" });
  const byLabel = Object.fromEntries(items.map((i) => [i.label, i.ok]));
  assert.equal(byLabel["Search description written (120–160 characters)"], false);
  assert.equal(byLabel["Cover image chosen"], false);
  assert.equal(byLabel["At least 600 words"], false);
  assert.equal(byLabel["Has a section heading"], false);
  assert.equal(byLabel["Filed under 1–4 topics"], false);
  assert.equal(byLabel["URL slug set"], false);
  assert.equal(checklistScore(items).passed, 3);
});
