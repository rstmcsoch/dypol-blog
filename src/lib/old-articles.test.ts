import assert from "node:assert/strict";
import test from "node:test";
import { cutoffFor, filterOldArticles, parseOldArticleQuery } from "./old-articles.ts";
import type { Article } from "../content/types.ts";

const NOW = new Date("2026-10-18T12:00:00.000Z");
const art = (id: string, status: Article["status"], publishedAt: string | null, updatedAt: string): Article => ({
  id, slug: id, title: id, excerpt: "", status, publishedAt, updatedAt, categoryId: "c", tagIds: [], motif: "corner", featured: false, blocks: [],
});

test("boundary: exactly 1 week old is NOT included; 1 week + 1 second is", () => {
  const exact = art("exact", "draft", null, "2026-10-11T12:00:00.000Z");
  const older = art("older", "draft", null, "2026-10-11T11:59:59.000Z");
  const newer = art("newer", "draft", null, "2026-10-11T12:00:01.000Z");
  const out = filterOldArticles([exact, older, newer], { preset: "week", scope: "drafts" }, NOW).map((m) => m.id);
  assert.deepEqual(out, ["older"]);
});

test("published uses its publish date even when saved recently; drafts use last-saved", () => {
  const pubOld = art("pub", "published", "2026-08-01T00:00:00.000Z", "2026-10-18T00:00:00.000Z");
  const draftOld = art("dr", "draft", null, "2026-08-01T00:00:00.000Z");
  const out = filterOldArticles([pubOld, draftOld], { preset: "month", scope: "all" }, NOW);
  assert.deepEqual(out.map((m) => [m.id, m.basis]), [["pub", "published"], ["dr", "last saved"]]);
});

test("scope filtering: safest default excludes published", () => {
  const all = [
    art("d", "draft", null, "2026-01-01T00:00:00.000Z"),
    art("u", "unpublished", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"),
    art("p", "published", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
  ];
  const ids = (scope: Parameters<typeof filterOldArticles>[1]["scope"]) => filterOldArticles(all, { preset: "3months", scope }, NOW).map((m) => m.id).sort();
  assert.deepEqual(ids("drafts-unpublished"), ["d", "u"]);
  assert.deepEqual(ids("drafts"), ["d"]);
  assert.deepEqual(ids("published"), ["p"]);
  assert.deepEqual(ids("all"), ["d", "p", "u"]);
});

test("cutoffs: week = 7 days, month/3months are calendar months, custom days validated", () => {
  assert.equal(cutoffFor({ preset: "week", scope: "all" }, NOW).toISOString(), "2026-10-11T12:00:00.000Z");
  assert.equal(cutoffFor({ preset: "month", scope: "all" }, NOW).toISOString(), "2026-09-18T12:00:00.000Z");
  assert.equal(cutoffFor({ preset: "3months", scope: "all" }, NOW).toISOString(), "2026-07-18T12:00:00.000Z");
  assert.equal(cutoffFor({ preset: "custom", customDays: 10, scope: "all" }, NOW).toISOString(), "2026-10-08T12:00:00.000Z");
  assert.throws(() => parseOldArticleQuery({ preset: "custom", customDays: 0, scope: "all" }), /between 1 and 3650/);
  assert.throws(() => parseOldArticleQuery({ preset: "year", scope: "all" }), /Choose an age/);
  assert.deepEqual(parseOldArticleQuery({ preset: "week", scope: "drafts-unpublished" }), { preset: "week", customDays: undefined, scope: "drafts-unpublished" });
});
