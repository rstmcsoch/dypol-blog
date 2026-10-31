import { test } from "node:test";
import assert from "node:assert/strict";
import { authorToAssign, bylineName, checkAuthorName, sameAuthor } from "./author-name.ts";

test("checkAuthorName accepts real names and trims", () => {
  assert.deepEqual(checkAuthorName("  John   Daniel "), { ok: true, value: "John Daniel" });
  assert.deepEqual(checkAuthorName("Mary-Jane O'Neil Jr."), { ok: true, value: "Mary-Jane O'Neil Jr." });
  assert.deepEqual(checkAuthorName("José Álvarez"), { ok: true, value: "José Álvarez" });
  assert.deepEqual(checkAuthorName(""), { ok: true, value: null });
  assert.deepEqual(checkAuthorName(undefined), { ok: true, value: null });
});

test("checkAuthorName rejects bad input", () => {
  for (const bad of ["J", "<b>Bob</b>", "Bob & Co", "R2D2", "x".repeat(61), "-Bob", "Bob_Smith", "Bob@x"]) {
    assert.equal(checkAuthorName(bad).ok, false, bad);
  }
  assert.equal(checkAuthorName(42).ok, false);
});

test("sameAuthor is case-insensitive", () => {
  assert.equal(sameAuthor("John Daniel", " john daniel"), true);
  assert.equal(sameAuthor("John Daniel", "Michael Gose"), false);
  assert.equal(sameAuthor(null, "x"), false);
});

test("bylineName falls back to DYPOL LABS", () => {
  assert.equal(bylineName("John Daniel"), "John Daniel");
  assert.equal(bylineName(""), "DYPOL LABS");
  assert.equal(bylineName(null), "DYPOL LABS");
});

test("authorToAssign: create stamps the acting profile's author", () => {
  assert.equal(authorToAssign({ kind: "create", currentAuthor: null, profileAuthor: "John Daniel", actingProfileId: "p1", ownerProfileId: null }), "John Daniel");
  assert.equal(authorToAssign({ kind: "create", currentAuthor: null, profileAuthor: "", actingProfileId: "p1", ownerProfileId: null }), null);
});

test("authorToAssign: update never overwrites and never stamps another profile", () => {
  assert.equal(authorToAssign({ kind: "update", currentAuthor: "John Daniel", profileAuthor: "Michael Gose", actingProfileId: "p2", ownerProfileId: "p2" }), null);
  assert.equal(authorToAssign({ kind: "update", currentAuthor: null, profileAuthor: "Michael Gose", actingProfileId: "p2", ownerProfileId: "p1" }), null);
  assert.equal(authorToAssign({ kind: "update", currentAuthor: null, profileAuthor: "Michael Gose", actingProfileId: "p2", ownerProfileId: "p2" }), "Michael Gose");
  assert.equal(authorToAssign({ kind: "update", currentAuthor: "", profileAuthor: "Michael Gose", actingProfileId: "default", ownerProfileId: null }), null);
});

test("JSON-LD author is Person when set, Organization fallback; RSS dc:creator", async () => {
  const { articleJsonLd, rssXml } = await import("./seo.ts");
  const base = { slug: "a", title: "T", excerpt: "E", description: "D", publishedAt: "2026-10-31T00:00:00Z", updatedAt: "2026-10-31T00:00:00Z", topics: [] as string[] };
  const withAuthor = articleJsonLd({ origin: "https://blog.dypol.workers.dev", siteName: "S", publisher: "DYPOL LABS", article: { ...base, authorName: "John Daniel" } }) as { author: Array<{ "@type": string; name: string }> };
  assert.deepEqual(withAuthor.author[0], { "@type": "Person", name: "John Daniel" });
  const without = articleJsonLd({ origin: "https://blog.dypol.workers.dev", siteName: "S", publisher: "DYPOL LABS", article: base }) as { author: Array<{ "@type": string; name: string }> };
  assert.equal(without.author[0]["@type"], "Organization");
  assert.equal(without.author[0].name, "DYPOL LABS");
  const rss = rssXml({ origin: "https://blog.dypol.workers.dev", siteTitle: "S", description: "D", publisher: "DYPOL LABS", articles: [{ ...base, authorName: "Michael Gose" }, { ...base, slug: "b" }] });
  assert.match(rss, /<dc:creator>Michael Gose<\/dc:creator>/);
  assert.match(rss, /<dc:creator>DYPOL LABS<\/dc:creator>/);
  assert.match(rss, /xmlns:dc=/);
});
