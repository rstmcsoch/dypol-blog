import assert from "node:assert/strict";
import test from "node:test";
import { footerColumns, normalizeSocials, validSocialUrl, visibleSocials } from "./social-links.ts";
import { normalizeSite, parseSite } from "../content/validate.ts";

test("normalizeSocials: canonical order, dedupe, invalid URLs dropped to hidden", () => {
  const out = normalizeSocials([
    { platform: "youtube", url: "https://youtube.com/@dypol", visible: true },
    { platform: "x", url: "http://insecure.example/x", visible: true },
    { platform: "x", url: "https://x.com/dypol", visible: true },
    { platform: "tiktok", url: "https://tiktok.com/@x", visible: true },
    { platform: "rss", url: "/feed.xml", visible: false },
    { platform: "email", url: "not-an-email", visible: true },
  ]);
  assert.deepEqual(out.map((s) => s.platform), ["x", "youtube", "rss", "email"]);
  assert.equal(out[0]?.url, "https://x.com/dypol");
  assert.equal(out.find((s) => s.platform === "email")?.url, "");
  assert.deepEqual(visibleSocials(out).map((s) => s.platform), ["x", "youtube"]);
});

test("validSocialUrl: https only, mailto for email, path for RSS", () => {
  assert.equal(validSocialUrl("x", "https://x.com/dypol"), true);
  assert.equal(validSocialUrl("x", "http://x.com/dypol"), false);
  assert.equal(validSocialUrl("x", "javascript:alert(1)"), false);
  assert.equal(validSocialUrl("email", "mailto:hi@dypol.example"), true);
  assert.equal(validSocialUrl("email", "https://x.com"), false);
  assert.equal(validSocialUrl("rss", "/feed.xml"), true);
  assert.equal(validSocialUrl("rss", "https://dypol.example/feed.xml"), true);
  assert.equal(validSocialUrl("x", ""), true);
});

test("site settings: socials survive normalize; parse rejects a non-https URL", () => {
  const site = normalizeSite({ socials: [{ platform: "x", url: "https://x.com/dypol", visible: true }] });
  assert.deepEqual(site.socials, [{ platform: "x", url: "https://x.com/dypol", visible: true }]);
  assert.deepEqual(normalizeSite({}).socials, []);
  assert.throws(() => parseSite({ ...site, socials: [{ platform: "x", url: "http://x.com/dypol", visible: true }] }));
  assert.doesNotThrow(() => parseSite(site));
});

const ALL_PAGES = [
  "about", "contact", "editorial-policy", "corrections-policy", "privacy-policy",
  "terms", "dmca", "cookie-policy", "disclaimer",
].map((slug) => ({ slug, title: slug }));

test("footerColumns: three organised columns, About only once, only existing pages", () => {
  const columns = footerColumns(ALL_PAGES);
  assert.deepEqual(columns.map((c) => c.heading), ["Explore", "Company", "Legal"]);
  const hrefs = columns.flatMap((c) => c.links.map((l) => l.href));
  assert.equal(hrefs.filter((h) => h === "/about").length, 1);
  assert.deepEqual(columns[0]?.links.map((l) => l.href), ["/", "/articles", "/topics", "/about"]);
  assert.deepEqual(columns[2]?.links.map((l) => l.href), ["/privacy-policy", "/terms", "/dmca", "/cookie-policy", "/disclaimer"]);
  // A page removed from the published list drops out of the footer.
  const withoutTerms = footerColumns(ALL_PAGES.filter((p) => p.slug !== "terms"));
  assert.ok(!withoutTerms.flatMap((c) => c.links).some((l) => l.href === "/terms"));
  // No pages at all: only the fixed Explore links remain.
  assert.deepEqual(footerColumns([]).map((c) => c.heading), ["Explore"]);
});
