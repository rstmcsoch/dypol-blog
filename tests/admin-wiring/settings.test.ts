import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { site } from "../../src/content/site.ts";
import { normalizeSite, parseSite } from "../../src/content/validate.ts";
import { windowPages, pageHref, parsePage } from "../../src/lib/pagination.ts";
import { visibleSocials } from "../../src/lib/social-links.ts";
import { articleJsonLd } from "../../src/lib/seo.ts";

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
test("settings round trip keeps identity, analytics and ordered footer columns", () => {
  const changed = parseSite({ ...site, name: "Wiring check", title: "Preview title", publisher: "Preview publisher",
    analytics: { enabled: false, measurementId: "G-PREVIEW", consentText: "Preview consent" },
    footer: { note: "© {year}", links: [], columns: [{ heading: "Custom", links: [{ label: "Test", href: "/about", newTab: true }] }] },
  });
  assert.deepEqual(normalizeSite(JSON.parse(JSON.stringify(changed))), changed);
  assert.equal(normalizeSite({ name: "Legacy" }).analytics.measurementId, site.analytics.measurementId);
  assert.throws(() => parseSite({ ...changed, analytics: { ...changed.analytics, measurementId: "bad<script>" } }));
  assert.throws(() => parseSite({ ...changed, footer: { ...changed.footer, columns: [{ heading: "Bad", links: [{ label: "Bad", href: "javascript:alert(1)" }] }] } }));
});
test("four-page archive includes page three; larger windows retain real gaps", () => {
  assert.deepEqual(windowPages(1, 4), [1, 2, 3, 4]);
  assert.deepEqual(windowPages(2, 4), [1, 2, 3, 4]);
  assert.deepEqual(windowPages(5, 10), [1, "gap", 4, 5, 6, "gap", 10]);
  assert.equal(pageHref("/articles", 1), "/articles");
  assert.equal(pageHref("/articles", 3), "/articles?page=3");
  assert.equal(parsePage("-1"), -1);
});
test("empty, disabled and platform-root socials stay hidden", () => {
  assert.deepEqual(visibleSocials([
    { platform: "x", url: "https://x.com/", visible: true },
    { platform: "instagram", url: "", visible: true },
    { platform: "youtube", url: "https://youtube.com/@channel", visible: false },
    { platform: "rss", url: "/feed.xml", visible: true },
  ]).map((s) => s.platform), ["rss"]);
});
test("article JSON-LD uses owner publisher and selected logo", () => {
  const ld = articleJsonLd({ origin: "https://preview.example", siteName: "Preview", publisher: "Owner publisher", logoMediaId: "logo-id",
    article: { slug: "test", title: "Title", excerpt: "Excerpt", description: "Description", publishedAt: null, updatedAt: "2026-10-28T00:00:00Z", topics: [] } });
  assert.equal(ld.publisher.name, "Owner publisher");
  assert.equal(ld.publisher.logo?.url, "https://preview.example/media/logo-id");
  assert.equal(ld.author[0].name, "Owner publisher");
});
test("public identity readers no longer override saved names", () => {
  const repo = source("src/content/repository.server.ts");
  assert.doesNotMatch(repo, /name: "DYPOL BLOG"/);
  for (const path of ["src/components/site/static-page.tsx", "src/components/site/blocks.tsx", "src/components/site/footer.tsx"]) {
    assert.doesNotMatch(source(path), /DYPOL Blog|DYPOL BLOG/);
  }
  const root = source("src/routes/__root.tsx");
  assert.doesNotMatch(root, /src: GA_SCRIPT_URL|children: gtagInitScript/);
  assert.match(source("src/components/site/google-analytics.tsx"), /if \(!allowed\) return/);
  assert.match(root, /if \(desk\) return <Outlet/);
});
