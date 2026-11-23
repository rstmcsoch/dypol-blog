import assert from "node:assert/strict";
import test from "node:test";
import { articleWriteSchema } from "../../../content/validate.ts";
import { masterNewArticleWrite, pickMotif } from "./article-write.ts";

test("Master create payload satisfies the editor write schema", () => {
  const raw = masterNewArticleWrite({
    title: "Master MCP handshake end-to-end test draft",
    slug: "master-mcp-e2e-test",
    excerpt: "Temporary draft",
    topicIds: ["tech-news"],
    blocks: [{ type: "paragraph", text: "Hello." }],
    intent: "save",
  });
  const parsed = articleWriteSchema.parse(raw);
  assert.equal(parsed.id, null);
  assert.equal(parsed.categoryId, "tech-news");
  assert.deepEqual(parsed.topicIds, ["tech-news"]);
  assert.deepEqual(parsed.tagIds, []);
  assert.equal(parsed.publishedAt, null);
  assert.equal(parsed.intent, "save");
  assert.ok(["corner", "band", "split", "stamp", "stack", "edge"].includes(parsed.motif));
});

test("create payload refuses an empty topic list instead of sending an invalid schema", () => {
  assert.throws(() => masterNewArticleWrite({ title: "X title", topicIds: [], blocks: [], intent: "save" }), /topic_id/);
});

test("pickMotif is stable for a title", () => {
  assert.equal(pickMotif("Same title"), pickMotif("Same title"));
});
