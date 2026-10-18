import assert from "node:assert/strict";
import test from "node:test";
import {
  AREA_TYPES,
  defaultLayout,
  duplicateBlock,
  layoutDocSchema,
  moveBlock,
  newBlock,
  parseLayout,
  summariseBlock,
  type Block,
} from "./blocks.ts";

test("a new block is valid, area-appropriate and carries no shared state", () => {
  const hero = newBlock("hero", "homepage");
  assert.equal(hero.type, "hero");
  assert.equal(hero.enabled, true);
  const other = newBlock("hero", "homepage");
  assert.notEqual(hero.id, other.id);
  for (const type of AREA_TYPES.homepage) {
    const block = newBlock(type, "homepage");
    assert.equal(block.type, type);
    assert.ok(block.id.length > 0);
  }
  for (const type of AREA_TYPES.sidebar) {
    const block = newBlock(type, "sidebar");
    assert.equal(block.type, type);
  }
  const list = newBlock("articleList", "sidebar") as Extract<Block, { type: "articleList" }>;
  assert.equal(list.style, "list");
  assert.equal(list.count, 5);
  assert.equal(list.showExcerpt, false, "sidebar lists are compact by default");
});

test("blocks are validated: bad links, unknown types and wild numbers are refused", () => {
  assert.equal(parseLayout({ version: 2, homepage: { blocks: [{ ...newBlock("richText", "homepage"), viewAll: { label: "x", href: "javascript:alert(1)" } }] }, sidebar: { enabled: true, blocks: [] } }), null);
  assert.equal(parseLayout({ version: 1, homepage: { blocks: [] } }), null);
  assert.equal(parseLayout("nonsense"), null);
  const list = newBlock("articleList", "homepage");
  assert.equal(layoutDocSchema.safeParse({ version: 2, homepage: { blocks: [{ ...list, count: 999 }] }, sidebar: { enabled: true, blocks: [] } }).success, false);
  assert.equal(layoutDocSchema.safeParse({ version: 2, homepage: { blocks: [{ ...list, source: "invented" }] }, sidebar: { enabled: true, blocks: [] } }).success, false);
});

test("duplicate, reorder and summary behave as the desk expects", () => {
  const first = newBlock("richText", "homepage");
  const second = newBlock("richText", "homepage");
  const blocks = [first, second];
  const moved = moveBlock(blocks, first.id, 1);
  assert.deepEqual(moved.map((block) => block.id), [second.id, first.id]);
  assert.deepEqual(moveBlock(blocks, first.id, -1).map((block) => block.id), [first.id, second.id], "moving past the edge changes nothing");
  const copy = duplicateBlock(blocks, first.id);
  assert.equal(copy.length, 3);
  assert.equal(copy[1]?.type, "richText");
  assert.notEqual(copy[1]?.id, first.id);
  assert.equal(copy[0]?.id, first.id);

  const list = { ...(newBlock("articleList", "homepage") as Extract<Block, { type: "articleList" }>), source: "manual" as const, slugs: ["a", "b"], count: 6 };
  assert.equal(summariseBlock(list).includes("2 picked"), true);
});

test("the default layout keeps today's homepage and sidebar order", () => {
  const doc = defaultLayout();
  assert.deepEqual(
    doc.homepage.blocks.map((block) => block.type),
    ["hero", "articleList", "categories"],
  );
  assert.deepEqual(
    doc.sidebar.blocks.map((block) => block.type),
    ["articleTags", "articleList", "share"],
  );
  assert.equal(doc.sidebar.enabled, true);
  // Round-trips through storage unchanged.
  assert.deepEqual(parseLayout(JSON.parse(JSON.stringify(doc))), doc);
});
