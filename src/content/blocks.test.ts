import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBlocks } from "./blocks.ts";
import { tickerEntries } from "./ticker.ts";
import { block, site } from "./site.ts";
import type { Article, Category } from "./types.ts";

const cats: Category[] = [{ id: "c1", slug: "design", label: "Design", description: "" } as Category, { id: "c2", slug: "notes", label: "Notes", description: "" } as Category];
const art = (n: number, cat = "c1", extra: Partial<Article> = {}): Article =>
  ({ id: `a${n}`, slug: `s${n}`, title: `T${n}`, excerpt: "e", categoryId: cat, topicIds: [cat], tagIds: [], blocks: [{ type: "paragraph", text: "x" }], status: "published", publishedAt: `2026-10-${10 + n}`, featured: false, motif: "corner", coverMediaId: null, ...extra }) as unknown as Article;
const live = [art(5), art(4, "c2"), art(3), art(2, "c2"), art(1)];
const ctx = { site, live, categories: cats, tags: [], views: { a3: 9, a1: 2 } };

test("featured + also + latest do not repeat stories", () => {
  const r = resolveBlocks([block("f", "featured"), block("a", "also", { count: 2 }), block("l", "latest", { count: 9 })], ctx, "home");
  assert.deepEqual(r.map((x) => x.cards.map((c) => c.id)), [["a5"], ["a4", "a3"], ["a2", "a1"]]);
});

test("category block, multiple instances, hidden blocks skipped, empty dropped", () => {
  const r = resolveBlocks([block("x", "category", { categoryId: "c2" }), block("y", "category", { categoryId: "c1", enabled: false }), block("z", "tag", { tagId: "none" })], ctx, "home");
  assert.equal(r.length, 1);
  assert.equal(r[0]?.title, "Notes");
  assert.deepEqual(r[0]?.cards.map((c) => c.id), ["a4", "a2"]);
});

test("popular uses view counts and custom titles win", () => {
  const r = resolveBlocks([block("p", "popular", { title: "Hot" })], ctx, "home");
  assert.equal(r[0]?.title, "Hot");
  assert.deepEqual(r[0]?.cards.map((c) => c.id), ["a3", "a1"]);
});

test("text block only renders with text; cta always", () => {
  const r = resolveBlocks([block("t", "text"), block("c", "cta", { ctaLabel: "Go", ctaHref: "/about" })], ctx, "home");
  assert.deepEqual(r.map((x) => x.block.type), ["cta"]);
});

test("ticker: pinned with no live picks falls back to latest (prod regression)", () => {
  const t = tickerEntries({ ...site, trending: { ...site.trending, source: "pinned", slugs: ["gone"], count: 2 } }, live);
  assert.deepEqual(t.map((x) => x.id), ["a5", "a4"]);
  const off = tickerEntries({ ...site, trending: { ...site.trending, enabled: false } }, live);
  assert.equal(off.length, 0);
  const pop = tickerEntries({ ...site, trending: { ...site.trending, source: "popular", count: 5 } }, live, { a1: 3 });
  assert.deepEqual(pop.map((x) => x.id), ["a1"]);
});

test("ticker default is on, rotating, newest articles", () => {
  assert.equal(site.trending.enabled, true);
  assert.equal(site.trending.mode, "rotate");
  assert.equal(site.trending.source, "latest");
});

// ---- t96: sectioned homepage ----
const many = Array.from({ length: 40 }, (_, i) => art(40 - i, i % 3 === 0 ? "c2" : "c1", { publishedAt: new Date(Date.UTC(2026, 8, 1) + (40 - i) * 864e5).toISOString() }));
const t96Blocks = [
  block("f", "featured"),
  block("a", "also", { count: 3 }),
  block("r", "river", { count: 6 }),
  block("tr", "topicRows", { count: 4 }),
  block("q", "quickReads", { count: 4 }),
  block("rel", "related", { count: 3 }),
  block("m", "moreStories", { count: 9 }),
];

test("t96: no story appears twice across the article sections", () => {
  const views = Object.fromEntries(many.map((a, i) => [a.id, 100 - i]));
  const r = resolveBlocks(t96Blocks, { ...ctx, live: many, views }, "home");
  const ids = r.flatMap((x) => x.cards.map((c) => c.id));
  assert.equal(new Set(ids).size, ids.length, "article sections never repeat");
  assert.deepEqual(r.map((x) => x.block.type), ["featured", "also", "river", "topicRows", "quickReads", "related", "moreStories"]);
  const river = r.find((x) => x.block.type === "river");
  assert.equal(river?.cards.length, 6);
  assert.ok((river?.rail?.length ?? 0) >= 3, "most-read rail shows");
  assert.ok(!river?.rail?.some((c) => c.id === "a40"), "rail never repeats the lead");
  const rows = r.find((x) => x.block.type === "topicRows")?.rows ?? [];
  assert.ok(rows.length >= 1 && rows.every((row) => row.cards.length >= 3 && row.cards.every((c) => c.topicLabels.includes(row.category.label))));
});

test("t96: a tiny archive drops empty sections instead of rendering empty headings", () => {
  const r = resolveBlocks(t96Blocks, { ...ctx, live: live.slice(0, 3), views: {} }, "home");
  assert.deepEqual(r.map((x) => x.block.type), ["featured", "also"]);
  const r2 = resolveBlocks(t96Blocks, { ...ctx, live: many.slice(0, 8), views: {} }, "home");
  const river = r2.find((x) => x.block.type === "river");
  assert.deepEqual(river?.rail, [], "no views → no rail, river goes full width");
  assert.equal(r2.find((x) => x.block.type === "topicRows"), undefined, "rows need 3 unseen stories");
});

test("t96: homepage topics grid shows busiest non-empty topics first", () => {
  const r = resolveBlocks([block("t", "topics", { count: 5 })], { ...ctx, categories: [...cats, { id: "c3", slug: "empty", label: "Empty", description: "" } as Category] }, "home");
  assert.deepEqual(r[0]?.topics?.map((t) => t.category.id), ["c1", "c2"]);
});
