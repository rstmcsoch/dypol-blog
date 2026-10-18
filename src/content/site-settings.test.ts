import assert from "node:assert/strict";
import test from "node:test";
import { site } from "./site.ts";
import { tickerEntries } from "./ticker.ts";
import { normalizeSite, parseSite } from "./validate.ts";
import type { Article } from "./types.ts";

test("a legacy stored settings row (before these features) gets every new default", () => {
  const legacy = { name: "Mine", labels: { featured: "Top" }, trending: { enabled: true, label: "Now", slugs: ["a"] } };
  const out = normalizeSite(legacy);
  assert.equal(out.name, "Mine");
  assert.equal(out.labels.featured, "Top");
  assert.equal(out.labels.alsoLike, "You may also like");
  assert.equal(out.labels.newStories, "New stories");
  assert.deepEqual(out.trending.slugs, ["a"]);
  assert.equal(out.trending.source, "pinned");
  assert.equal(out.trending.animate, false);
  assert.deepEqual(out.home, site.home);
  assert.deepEqual(out.articleSidebar, site.articleSidebar);
  assert.deepEqual(out.appearance, site.appearance);
});

test("one invalid new group falls back alone, the rest is kept", () => {
  const out = normalizeSite({ appearance: { darkness: 5, whiteness: 100, accent: "nope", coverFallback: "plate" }, articleSidebar: { enabled: false, blocks: [], count: 3 } });
  assert.deepEqual(out.appearance, site.appearance);
  assert.equal(out.articleSidebar.enabled, false);
});

test("PR #5 homepage sections become builder blocks (unknown/duplicate dropped, order kept)", () => {
  const out = normalizeSite({ home: { sections: [{ id: "latest", enabled: false, count: 5 }, { id: "bogus", enabled: true, count: 1 }, { id: "latest", enabled: true, count: 9 }, { id: "featured", enabled: true, count: 1 }] } });
  assert.deepEqual(out.home.blocks.map((b) => b.type), ["latest", "featured"]);
  assert.equal(out.home.blocks[0]?.enabled, false);
  assert.equal(out.home.blocks[0]?.count, 5);
});

test("PR #5 sidebar string blocks are upgraded, count carried over", () => {
  const out = normalizeSite({ articleSidebar: { enabled: true, blocks: ["share", "related"], count: 6 } });
  assert.deepEqual(out.articleSidebar.blocks.map((b) => [b.type, b.count]), [["share", 6], ["related", 6]]);
});

test("ticker: stored PR #5 value without mode becomes rotate; animate=true becomes scroll", () => {
  assert.equal(normalizeSite({ trending: { enabled: true, label: "Now", slugs: [], source: "pinned", count: 5, customItems: [], animate: false, speed: 40 } }).trending.mode, "rotate");
  assert.equal(normalizeSite({ trending: { ...site.trending, animate: true, mode: undefined } }).trending.mode, "scroll");
});

test("builder blocks validate category/tag/cta requirements", () => {
  const base = normalizeSite({});
  const blk = (o: object) => ({ ...base.home.blocks[0], id: "x1", ...o });
  assert.throws(() => parseSite({ ...base, home: { blocks: [blk({ type: "category", categoryId: "" })] } }));
  assert.throws(() => parseSite({ ...base, home: { blocks: [blk({ type: "cta", ctaLabel: "Go", ctaHref: "javascript:alert(1)" })] } }));
  assert.throws(() => parseSite({ ...base, home: { blocks: [blk({ type: "share" })] } }));
  assert.doesNotThrow(() => parseSite({ ...base, home: { blocks: [blk({ type: "cta", ctaLabel: "Subscribe", ctaHref: "https://example.com" }), blk({ id: "x2", type: "text", body: "Hi" })] } }));
});

test("saving rejects bad values with clear paths", () => {
  const base = normalizeSite({});
  assert.throws(() => parseSite({ ...base, appearance: { ...base.appearance, darkness: 50 } }));
  assert.throws(() => parseSite({ ...base, appearance: { ...base.appearance, accent: "#fff" } }));
  assert.throws(() => parseSite({ ...base, trending: { ...base.trending, speed: 1 } }));
  assert.throws(() => parseSite({ ...base, trending: { ...base.trending, customItems: [{ id: "x", text: "Hi", href: "javascript:alert(1)" }] } }));
  assert.throws(() => parseSite({ ...base, articleSidebar: { ...base.articleSidebar, blocks: ["tags", "tags"] } }));
  assert.doesNotThrow(() => parseSite({ ...base, trending: { ...base.trending, source: "custom", customItems: [{ id: "x", text: "Hi", href: "" }, { id: "y", text: "Docs", href: "https://example.com" }] } }));
});

const art = (n: number): Article => ({
  id: `id${n}`, slug: `s${n}`, title: `T${n}`, excerpt: "", status: "published", publishedAt: null, updatedAt: "", categoryId: "c", tagIds: [], motif: "corner", featured: false, blocks: [],
});

test("ticker sources: latest, pinned, custom, count, disabled", () => {
  const live = [art(1), art(2), art(3)];
  const base = normalizeSite({});
  assert.deepEqual(tickerEntries({ ...base, trending: { ...base.trending, source: "latest", count: 2 } }, live).map((x) => x.slug), ["s1", "s2"]);
  assert.deepEqual(tickerEntries({ ...base, trending: { ...base.trending, source: "pinned", slugs: ["s3", "gone", "s1"], count: 5 } }, live).map((x) => x.slug), ["s3", "s1"]);
  const custom = tickerEntries({ ...base, trending: { ...base.trending, source: "custom", count: 1, customItems: [{ id: "a", text: "Hello", href: "/about" }, { id: "b", text: "B", href: "" }] } }, live);
  assert.deepEqual(custom, [{ id: "a", title: "Hello", slug: null, href: "/about" }]);
  assert.deepEqual(tickerEntries({ ...base, trending: { ...base.trending, enabled: false } }, live), []);
});
