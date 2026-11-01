import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SLOT_CATALOG,
  codeFor,
  defaultAdsSettings,
  densityWarnings,
  inSchedule,
  inTextPositions,
  newCreative,
  normalizeAdsSettings,
  pageTypeForPath,
  pickCreative,
  seeded,
  slotDef,
  slotStatus,
  targets,
  type AdsSettings,
} from "./model.ts";

const P = { type: "paragraph" };
const H = { type: "heading" };
const rules = { maxInText: 2, paragraphsBetween: 2, firstAfterParagraph: 2, a2MinParagraphs: 5 };

test("defaults: master on, every slot empty, optional slots off", () => {
  const s = defaultAdsSettings();
  assert.equal(s.master, true);
  assert.equal(s.slots.length, SLOT_CATALOG.length);
  for (const slot of s.slots) {
    assert.equal(slot.creatives.length, 0);
    assert.equal(slot.enabled, !slotDef(slot.id)!.optional);
    assert.equal(slotStatus(slot, s, Date.now()), slot.enabled ? "No code" : "Off");
  }
});

test("in-text positions: after paragraph 2, then 2 paragraphs later, only between paragraphs", () => {
  assert.deepEqual(inTextPositions([P, P, P, P, P, P], rules), [1, 3]);
  // a section heading is a natural break; a table/list is not
  assert.deepEqual(inTextPositions([P, P, H, P, P, P, P], rules), [1, 4]);
  assert.deepEqual(inTextPositions([P, P, { type: "table" }, P, P, P, P], rules), [3, 5]);
  // never after the last block
  assert.deepEqual(inTextPositions([P, P], rules), []);
  // short article: no A2
  assert.deepEqual(inTextPositions([P, P, P, P], rules), [1]);
  // embeds don't count as paragraphs
  assert.deepEqual(inTextPositions([P, { type: "paragraph", embed: true }, P, P], rules), [2]);
  assert.deepEqual(inTextPositions([P, P, P], { ...rules, maxInText: 0 }), []);
  // owner can raise the max — no hard cap
  assert.equal(inTextPositions(Array(30).fill(P), { ...rules, maxInText: 10, paragraphsBetween: 1 }).length, 10);
});

test("schedule: dates, IST days and windows (overnight)", () => {
  const t = Date.parse("2026-11-02T06:30:00Z"); // Monday 12:00 IST
  const base = { start: null, end: null, days: [], from: "", to: "" };
  assert.equal(inSchedule(base, t), true);
  assert.equal(inSchedule({ ...base, start: "2026-11-03T00:00:00.000Z" }, t), false);
  assert.equal(inSchedule({ ...base, end: "2026-11-01T00:00:00.000Z" }, t), false);
  assert.equal(inSchedule({ ...base, days: [1] }, t), true);
  assert.equal(inSchedule({ ...base, days: [0, 2] }, t), false);
  assert.equal(inSchedule({ ...base, from: "09:00", to: "13:00" }, t), true);
  assert.equal(inSchedule({ ...base, from: "13:00", to: "18:00" }, t), false);
  assert.equal(inSchedule({ ...base, from: "22:00", to: "13:00" }, t), true);
});

test("status: live, hidden, scheduled, expired", () => {
  const s = defaultAdsSettings();
  const slot = s.slots.find((x) => x.id === "A1")!;
  const c = newCreative(slotDef("A1")!, "c1");
  c.desktop.html = "<div>ad</div>";
  slot.creatives = [c];
  const now = Date.parse("2026-11-02T06:30:00Z");
  assert.equal(slotStatus(slot, s, now), "Live");
  assert.equal(slotStatus({ ...slot, hidden: true }, s, now), "Hidden");
  assert.equal(slotStatus(slot, { ...s, master: false }, now), "Off");
  assert.equal(slotStatus({ ...slot, schedule: { ...slot.schedule, start: "2027-01-01T00:00:00.000Z" } }, s, now), "Scheduled");
  assert.equal(slotStatus({ ...slot, schedule: { ...slot.schedule, end: "2026-01-01T00:00:00.000Z" } }, s, now), "Expired");
});

test("codeFor: tablet/mobile can inherit desktop", () => {
  const c = newCreative(slotDef("G1")!, "c1");
  c.desktop.html = "D";
  assert.equal(codeFor(c, "mobile")!.html, "D");
  c.mobile = { html: "M", size: "320x50", inherit: false };
  assert.equal(codeFor(c, "mobile")!.html, "M");
});

test("pickCreative: weights, exclusions, sponsor-first", () => {
  const list = [
    { id: "a", kind: "code" as const, weight: 1 },
    { id: "b", kind: "sponsor" as const, weight: 3 },
  ];
  assert.equal(pickCreative(list, "weighted", 0.1)!.id, "a");
  assert.equal(pickCreative(list, "weighted", 0.9)!.id, "b");
  assert.equal(pickCreative(list, "sponsor-first", 0.0)!.id, "b");
  assert.equal(pickCreative(list, "weighted", 0.1, new Set(["a"]))!.id, "b");
  assert.equal(pickCreative([], "weighted", 0.5), null);
  const r = seeded(42, "A1:0");
  assert.equal(r, seeded(42, "A1:0"));
  assert.ok(r >= 0 && r < 1);
});

test("targeting: pages, slugs and topics", () => {
  const t = { pages: ["article" as const], devices: ["desktop" as const], includeSlugs: [], excludeSlugs: ["no-ads"], includeTopics: [], excludeTopics: ["health"] };
  assert.equal(targets(t, { type: "article", slug: "x" }), true);
  assert.equal(targets(t, { type: "home" }), false);
  assert.equal(targets(t, { type: "article", slug: "no-ads" }), false);
  assert.equal(targets(t, { type: "article", slug: "x", topics: ["health"] }), false);
  assert.equal(targets({ ...t, includeTopics: ["tech"] }, { type: "article", slug: "x", topics: ["tech"] }), true);
});

test("normalize: tolerant of junk, keeps code as-is, drops unknown sponsors", () => {
  const n = normalizeAdsSettings({ master: "yes", slots: [{ id: "A1", creatives: [{ id: "c<1>", desktop: { html: "<script>x</script>", size: "bogus" } }] }], sponsoredArticles: [{ slug: "A", sponsorId: "nope" }], rules: { maxInText: 999 } });
  assert.equal(n.master, true);
  const a1 = n.slots.find((x) => x.id === "A1")!;
  assert.equal(a1.creatives[0].id, "c1");
  assert.equal(a1.creatives[0].desktop.html, "<script>x</script>");
  assert.equal(a1.creatives[0].desktop.size, "300x250");
  assert.equal(n.sponsoredArticles.length, 0);
  assert.equal(n.rules.maxInText, 20);
  assert.deepEqual(normalizeAdsSettings(null).slots.length, SLOT_CATALOG.length);
});

test("density warnings are soft and never mention percentages", () => {
  const s: AdsSettings = defaultAdsSettings();
  for (const id of ["A4", "A5", "A1", "A2"]) {
    const slot = s.slots.find((x) => x.id === id)!;
    const c = newCreative(slotDef(id)!, `${id}-c`);
    c.desktop.html = "<div>ad</div>";
    slot.creatives = [c];
  }
  s.rules.maxInText = 6;
  const w = densityWarnings(s, Date.now());
  assert.ok(w.some((x) => x.includes("A4 and A5")));
  assert.ok(w.some((x) => x.includes("6 ads")));
  assert.ok(w.every((x) => !x.includes("%")));
});

test("pageTypeForPath: ad-free pages return null", () => {
  assert.equal(pageTypeForPath("/"), "home");
  assert.equal(pageTypeForPath("/articles"), "index");
  assert.equal(pageTypeForPath("/articles/x"), "article");
  assert.equal(pageTypeForPath("/topics"), "topics");
  assert.equal(pageTypeForPath("/topics/tech"), "topic");
  assert.equal(pageTypeForPath("/about"), "about");
  for (const p of ["/privacy-policy", "/terms", "/contact", "/cookie-policy", "/search", "/admin", "/admin/ads", "/nope/x"]) assert.equal(pageTypeForPath(p), null, p);
});
