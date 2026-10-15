import assert from "node:assert/strict";
import test from "node:test";
import { site } from "./site.ts";
import { resolveTicker } from "./ticker.ts";
import type { Article, SiteConfig } from "./types.ts";
import { normalizeSite } from "./validate.ts";

const art = (n: number, extra: Partial<Article> = {}): Article => ({
  id: `id${n}`,
  slug: `s${n}`,
  title: `T${n}`,
  excerpt: "",
  status: "published",
  publishedAt: `2026-10-0${n}T10:00:00.000Z`,
  updatedAt: "",
  categoryId: "news",
  tagIds: [],
  motif: "corner",
  featured: false,
  blocks: [],
  ...extra,
});

const config = (patch: Partial<SiteConfig["trending"]>): SiteConfig =>
  normalizeSite({ ...site, trending: { ...site.trending, ...patch } });

const live = [art(1), art(2), art(3)];

test("trending uses recorded views, ranks by them, and never invents numbers", () => {
  const views = new Map([
    ["id1", 4],
    ["id3", 9],
  ]);
  const withData = resolveTicker(config({ source: "trending", count: 3 }), live, { views });
  assert.deepEqual(withData.items.map((item) => item.slug), ["s3", "s1"]);
  assert.deepEqual(withData.items.map((item) => item.views), [9, 4]);
  assert.equal(withData.fallback, false);
  assert.equal(withData.note, "");

  const withoutData = resolveTicker(config({ source: "trending", count: 2 }), live, { views: new Map() });
  assert.deepEqual(withoutData.items.map((item) => item.slug), ["s3", "s2"], "newest first while metrics are empty");
  assert.equal(withoutData.fallback, true);
  assert.ok(withoutData.note.length > 0, "the desk is told why the fallback happened");
  assert.equal(withoutData.source, "latest");
  assert.equal(withoutData.items[0]?.views, undefined, "no fabricated view counts");
});

test("featured, category, pinned and custom sources stay honest about fallbacks", () => {
  const featured = resolveTicker(config({ source: "featured", count: 3 }), live, { featured: new Set(["id2"]) });
  assert.deepEqual(featured.items.map((item) => item.slug), ["s2"]);

  const noFeatured = resolveTicker(config({ source: "featured" }), live);
  assert.equal(noFeatured.fallback, true);
  assert.deepEqual(noFeatured.items.map((item) => item.slug), ["s3", "s2", "s1"]);

  const category = resolveTicker(config({ source: "category", categories: ["news"], count: 3 }), live);
  assert.deepEqual(category.items.map((item) => item.slug), ["s3", "s2", "s1"]);
  assert.equal(category.fallback, false);

  const otherCategory = resolveTicker(config({ source: "category", categories: ["culture"] }), live);
  assert.equal(otherCategory.fallback, true);

  const pinned = resolveTicker(config({ source: "pinned", slugs: ["s1", "gone"], count: 5 }), live);
  assert.deepEqual(pinned.items.map((item) => item.slug), ["s1"]);
  assert.equal(pinned.fallback, false);
  assert.match(pinned.note, /1 pinned article is not published/);

  const allPresentPinned = resolveTicker(config({ source: "pinned", slugs: ["s1", "s2"], count: 5 }), live);
  assert.equal(allPresentPinned.note, "");

  const deadPins = resolveTicker(config({ source: "pinned", slugs: ["gone", "also-gone"] }), live);
  assert.equal(deadPins.fallback, true);
  assert.deepEqual(deadPins.items.map((item) => item.slug), ["s3", "s2", "s1"]);
});

test("custom items keep their order, drop empty text, and never link nowhere", () => {
  const custom = resolveTicker(
    config({
      source: "custom",
      count: 5,
      customItems: [
        { id: "a", text: "First", href: "/about" },
        { id: "b", text: "Second", href: "" },
        { id: "a", text: "Duplicate id", href: "" },
      ],
    }),
    live,
  );
  assert.deepEqual(custom.items, [
    { id: "a", title: "First", slug: null, href: "/about" },
    { id: "b", title: "Second", slug: null, href: null },
  ]);
});

test("the strip stays empty-and-hidden for no content, and respects the switch", () => {
  assert.deepEqual(resolveTicker(config({ enabled: false }), live).items, []);
  const none = resolveTicker(config({ source: "trending" }), []);
  assert.deepEqual(none.items, []);
  assert.equal(none.fallback, false);
  assert.ok(none.note.includes("published"));
});

test("the count is respected and items are never repeated", () => {
  const many = [art(1), art(2), art(3), art(4), art(5)];
  const picked = resolveTicker(config({ source: "latest", count: 2 }), many);
  assert.equal(picked.items.length, 2);
  assert.equal(new Set(picked.items.map((item) => item.id)).size, 2);
});
