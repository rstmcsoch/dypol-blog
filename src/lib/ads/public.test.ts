import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultAdsSettings, newCreative, slotDef } from "./model.ts";
import { buildPublicAds, sponsorTarget } from "./public.ts";

const NOW = Date.parse("2026-11-02T06:30:00Z");

test("nothing live → null (the site renders exactly as without ads)", () => {
  assert.equal(buildPublicAds(defaultAdsSettings(), NOW, { seed: 1 }), null);
  const s = defaultAdsSettings();
  s.master = false;
  const c = newCreative(slotDef("G1")!, "c");
  c.desktop.html = "<b>x</b>";
  s.slots[0].creatives = [c];
  assert.equal(buildPublicAds(s, NOW, { seed: 1 }), null);
});

test("live code slot is published per device; hidden/off slots are not", () => {
  const s = defaultAdsSettings();
  const g1 = s.slots.find((x) => x.id === "G1")!;
  const c = newCreative(slotDef("G1")!, "c");
  c.desktop.html = "<b>x</b>";
  g1.creatives = [c];
  const out = buildPublicAds(s, NOW, { seed: 7 })!;
  assert.ok(out.slots.G1);
  assert.equal(out.slots.G1.creatives[0].code.desktop!.html, "<b>x</b>");
  assert.equal(out.slots.G1.creatives[0].code.mobile!.html, "<b>x</b>"); // "use desktop"
  g1.hidden = true;
  assert.equal(buildPublicAds(s, NOW, { seed: 7 }), null);
});

test("consent only when enabled and the visitor is in scope", () => {
  const s = defaultAdsSettings();
  const c = newCreative(slotDef("A1")!, "c");
  c.desktop.html = "<b>x</b>";
  s.slots.find((x) => x.id === "A1")!.creatives = [c];
  assert.equal(buildPublicAds(s, NOW, { seed: 1, country: "DE" })!.consent, null);
  s.consent.enabled = true;
  assert.ok(buildPublicAds(s, NOW, { seed: 1, country: "DE" })!.consent);
  assert.equal(buildPublicAds(s, NOW, { seed: 1, country: "IN" })!.consent, null);
  s.consent.scope = "all";
  assert.ok(buildPublicAds(s, NOW, { seed: 1, country: "IN" })!.consent);
});

test("sponsor banners: live campaign + matching size, tracked click link", () => {
  const s = defaultAdsSettings();
  s.sponsors = [{ id: "sp", name: "Acme", logoKey: null, url: "https://acme.test/?utm_source=keep", utmSource: "dypol", utmMedium: "banner", utmCampaign: "nov", start: null, end: null, notes: "", banners: [{ size: "300x250", key: "ads/a.png", width: 300, height: 250, mime: "image/png", bytes: 1000, key2x: "ads/b.png", alt: "Acme" }] }];
  const c = newCreative(slotDef("A3")!, "c1", "sponsor");
  c.sponsorId = "sp";
  s.slots.find((x) => x.id === "A3")!.creatives = [c];
  const out = buildPublicAds(s, NOW, { seed: 1 })!;
  const pc = out.slots.A3.creatives[0];
  assert.equal(pc.href, "/ad-click/c1?s=A3");
  assert.equal(pc.banners.desktop!.src, "/ad-media/a.png");
  assert.equal(pc.banners.desktop!.src2x, "/ad-media/b.png");
  const url = new URL(sponsorTarget(s.sponsors[0], "A3")!);
  assert.equal(url.searchParams.get("utm_source"), "keep");
  assert.equal(url.searchParams.get("utm_campaign"), "nov");
  s.sponsors[0].end = "2026-01-01T00:00:00.000Z";
  assert.equal(buildPublicAds(s, NOW, { seed: 1 }), null);
});

test("sponsored articles are published even with no slots", () => {
  const s = defaultAdsSettings();
  s.sponsors = [{ id: "sp", name: "Acme", logoKey: null, url: "https://acme.test", utmSource: "", utmMedium: "", utmCampaign: "", start: null, end: null, notes: "", banners: [] }];
  s.sponsoredArticles = [{ slug: "story", sponsorId: "sp" }];
  assert.equal(buildPublicAds(s, NOW, { seed: 1 })!.sponsored.story, "Acme");
});
