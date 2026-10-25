import { test } from "node:test";
import assert from "node:assert/strict";
import { findNearDuplicate, titleSimilarity } from "./near-duplicate";

const recent = [
  { id: "1", slug: "deepseek-v41-flash-1017-agent-benchmarks", title: "DeepSeek V4.1 Flash 1017 tops agent benchmarks", sourceUrls: ["https://example.com/deepseek"] },
  { id: "2", slug: "samsung-eyewear", title: "Samsung intelligent eyewear launches in November", sourceUrls: [] },
];

test("similar titles are near-duplicates", () => {
  assert.ok(titleSimilarity("DeepSeek V4.1 Flash 1017 tops agentic benchmarks", recent[0].title) >= 0.6);
  assert.equal(findNearDuplicate({ title: "Samsung's intelligent eyewear launches in November with Gemini", sourceUrls: [] }, recent)?.story.id, "2");
});

test("shared sources are near-duplicates", () => {
  const d = findNearDuplicate({ title: "Something else entirely", sourceUrls: ["https://www.example.com/deepseek/"] }, recent);
  assert.equal(d?.reason, "sources");
});

test("different stories pass", () => {
  assert.equal(findNearDuplicate({ title: "Apple ships a new MacBook Air", sourceUrls: ["https://apple.com/x"] }, recent), null);
});
