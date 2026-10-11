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

test("homepage sections: unknown ids dropped, duplicates removed, missing appended, order kept", () => {
  const out = normalizeSite({ home: { sections: [{ id: "latest", enabled: false, count: 5 }, { id: "bogus", enabled: true, count: 1 }, { id: "latest", enabled: true, count: 9 }, { id: "featured", enabled: true, count: 1 }] } });
  assert.deepEqual(out.home.sections.map((s) => s.id), ["latest", "featured", "also", "topics"]);
  assert.equal(out.home.sections[0]?.enabled, false);
  assert.equal(out.home.sections[0]?.count, 5);
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
