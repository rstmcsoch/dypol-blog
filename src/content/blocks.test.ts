import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBlocks } from "./blocks.ts";
import { tickerEntries } from "./ticker.ts";
import { block, site } from "./site.ts";
import { articlePlainText } from "./present.ts";
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

test("article plain text keeps takeaways and tables (RSS feed must not 500)", () => {
  const text = articlePlainText([
    { type: "paragraph", text: "Intro" },
    { type: "takeaways", items: ["One point", "Two point"] },
    { type: "table", headers: ["A", "B"], rows: [["1", "2"]] },
    { type: "code", code: "const n = 1;" },
    { type: "heading", level: 2, text: "Next" },
  ]);
  assert.match(text, /Intro/);
  assert.match(text, /One point/);
  assert.match(text, /A \| B/);
  assert.match(text, /const n = 1/);
  assert.equal(articlePlainText([]), "");
});
