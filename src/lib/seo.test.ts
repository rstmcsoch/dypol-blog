import assert from "node:assert/strict";
import { test } from "node:test";
import { absoluteUrl, articleJsonLd, breadcrumbJsonLd, canonicalOriginFrom, itemListJsonLd, metaDescription, newsSitemapXml, rssXml, sitemapXml, socialMeta, topicMetaDescription, websiteJsonLd, xmlEscape } from "./seo.ts";

const article = {
  slug: "hello-world",
  title: "Hello & <World>",
  excerpt: "A short excerpt.",
  description: "Meta description.",
  publishedAt: "2026-10-18T08:00:00.000Z",
  updatedAt: "2026-10-18T09:00:00.000Z",
  topics: ["Tech News", "Leaks"],
  coverMediaId: "media-1",
};

test("absoluteUrl joins and passes through absolute URLs", () => {
  assert.equal(absoluteUrl("https://example.com/", "/a/b"), "https://example.com/a/b");
  assert.equal(absoluteUrl("https://example.com", "a"), "https://example.com/a");
  assert.equal(absoluteUrl("https://example.com", "https://cdn.example.com/x.jpg"), "https://cdn.example.com/x.jpg");
});

test("article JSON-LD is NewsArticle with image, dates, author, sections", () => {
  const ld = articleJsonLd({ origin: "https://example.com", siteName: "DYPOL Blog", publisher: "DYPOL Labs", article });
  assert.equal(ld["@type"], "NewsArticle");
  assert.deepEqual(ld.image, ["https://example.com/media/media-1"]);
  assert.equal(ld.datePublished, "2026-10-18T08:00:00.000Z");
  assert.equal(ld.dateModified, "2026-10-18T09:00:00.000Z");
  assert.equal((ld.author as { name: string }[])[0].name, "DYPOL Labs");
  assert.equal(ld.mainEntityOfPage["@id"], "https://example.com/articles/hello-world");
  assert.doesNotThrow(() => JSON.stringify(ld));
});

test("breadcrumb + itemlist + website graph shapes", () => {
  const bc = breadcrumbJsonLd({ origin: "https://e.com", items: [{ name: "Home", path: "/" }, { name: "Tech News", path: "/topics/tech-news" }] });
  assert.equal(bc.itemListElement[1].position, 2);
  assert.equal(bc.itemListElement[1].item, "https://e.com/topics/tech-news");
  const il = itemListJsonLd({ origin: "https://e.com", items: [{ name: "A", path: "/articles/a" }] });
  assert.equal(il.itemListElement[0].url, "https://e.com/articles/a");
  const ws = websiteJsonLd({ origin: "https://e.com", siteName: "S", title: "T", description: "D", publisher: "P" });
  assert.equal(ws["@graph"].length, 2);
});

test("sitemap emits absolute loc + ISO lastmod, skips bad dates", () => {
  const xml = sitemapXml({ origin: "https://e.com/", urls: [{ path: "/", lastmod: null }, { path: "/articles/a", lastmod: "2026-10-18" }] });
  assert.match(xml, /<loc>https:\/\/e\.com\/<\/loc>/);
  assert.match(xml, /<lastmod>2026-10-18T00:00:00\.000Z<\/lastmod>/);
  assert.equal((xml.match(/<lastmod>/g) ?? []).length, 1);
});

test("news sitemap only includes the last 48 hours", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  const old = { ...article, slug: "old", publishedAt: "2026-10-15T12:00:00Z" };
  const xml = newsSitemapXml({ origin: "https://e.com", publicationName: "DYPOL Blog", articles: [article, old], now });
  assert.match(xml, /hello-world/);
  assert.doesNotMatch(xml, /articles\/old/);
  assert.match(xml, /<news:title>Hello &amp; &lt;World&gt;<\/news:title>/);
});

test("RSS is well-formed-ish, escaped, with categories and guid", () => {
  const xml = rssXml({ origin: "https://e.com", siteTitle: "DYPOL Blog", description: "Desc", articles: [article] });
  assert.match(xml, /<rss version="2\.0"/);
  assert.match(xml, /<title>Hello &amp; &lt;World&gt;<\/title>/);
  assert.match(xml, /<category>Tech News<\/category>/);
  assert.match(xml, /<guid isPermaLink="true">https:\/\/e\.com\/articles\/hello-world<\/guid>/);
});

test("social meta: article times only for articles, large card with image", () => {
  const meta = socialMeta({ title: "T", description: "D", url: "https://e.com/a", type: "article", siteName: "S", image: "https://e.com/i.jpg", publishedAt: article.publishedAt, section: "Tech News" });
  assert.ok(meta.some((m) => m.property === "article:published_time"));
  assert.ok(meta.some((m) => m.name === "twitter:card" && m.content === "summary_large_image"));
  const web = socialMeta({ title: "T", description: "D", url: "https://e.com/", type: "website", siteName: "S" });
  assert.ok(!web.some((m) => m.property === "article:published_time"));
  assert.equal(xmlEscape(`a & "b" <c>`), "a &amp; &quot;b&quot; &lt;c&gt;");
});

test("publisher logo uses the dedicated raster brand asset, not the favicon (t58/t74)", () => {
  const ld = articleJsonLd({ origin: "https://example.com", siteName: "DYPOL Blog", publisher: "DYPOL Labs", article });
  assert.equal(ld.publisher.logo.url, "https://example.com/logo.png");
  const site = websiteJsonLd({ origin: "https://example.com", siteName: "DYPOL Blog", title: "DYPOL Blog", description: "d", publisher: "DYPOL Labs" });
  const org = site["@graph"].find((n) => n["@type"] === "Organization");
  assert.ok(org);
  assert.equal(org.logo, "https://example.com/logo.png");
});

test("canonical origin consolidates workers.dev aliases, keeps custom domains (t58)", () => {
  assert.equal(canonicalOriginFrom("https://dypol-blog.rstmcsoch.workers.dev/articles/x"), "https://dypolblog.rstmcsoch.workers.dev");
  assert.equal(canonicalOriginFrom("https://abc123-dypolblog.rstmcsoch.workers.dev/"), "https://dypolblog.rstmcsoch.workers.dev");
  assert.equal(canonicalOriginFrom("https://blog.example.com/articles/x"), "https://blog.example.com");
});

test("metaDescription caps at 160 on a word boundary, collapses whitespace (t89)", () => {
  const long = "word ".repeat(60).trim();
  const out = metaDescription(long);
  assert.ok(out.length <= 160 && out.endsWith("…"));
  assert.equal(metaDescription("  a  b\n c "), "a b c");
  assert.equal(metaDescription("", "Fallback title"), "Fallback title");
});

test("topicMetaDescription enriches short seeded descriptions, keeps full ones (t89)", () => {
  const short = topicMetaDescription("Chips & Gaming", "Processors, graphics and the games industry.");
  assert.ok(short.length >= 90 && short.includes("Chips & Gaming") && short.includes("DYPOL Blog"));
  const full = "A".repeat(100);
  assert.equal(topicMetaDescription("X", full), full);
});

test("sitemap includes image namespace only when an image is present (t89)", () => {
  const withImg = sitemapXml({ origin: "https://e.com", urls: [{ path: "/articles/a", lastmod: "2026-10-18", imagePath: "/media/m1", imageTitle: "A & B" }] });
  assert.match(withImg, /xmlns:image=/);
  assert.match(withImg, /<image:loc>https:\/\/e\.com\/media\/m1<\/image:loc>/);
  assert.match(withImg, /<image:title>A &amp; B<\/image:title>/);
  const plain = sitemapXml({ origin: "https://e.com", urls: [{ path: "/", lastmod: null }] });
  assert.doesNotMatch(plain, /xmlns:image/);
});
