#!/usr/bin/env node
/**
 * SEO surface e2e (t48): robots, sitemaps (incl. news), RSS feed, manifest,
 * OG/Twitter meta, JSON-LD validity, canonical absoluteness, image alts,
 * noindex on login, immutable media caching. Read-only HTTP checks against
 * a local `wrangler dev`. Safe anywhere read-only, but written for local.
 *   BASE=http://127.0.0.1:8787 npm run test:e2e:seo
 */
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); }
  catch (e) { failures++; console.log(`not ok - ${name}\n  ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
}
const get = async (path) => {
  const r = await fetch(BASE + path);
  return { status: r.status, headers: r.headers, text: await r.text() };
};
function jsonLdBlocks(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return blocks.map((b) => JSON.parse(b.replaceAll("&quot;", '"')));
}

// Find a published article slug from the public index.
const index = await get("/articles");
const slugMatch = /href="\/articles\/([a-z0-9-]+)"/.exec(index.text);
assert.ok(slugMatch, "need at least one published article locally");
const slug = slugMatch[1];

await check("robots.txt: public allowed, private paths disallowed, sitemaps listed", async () => {
  const { status, text } = await get("/robots.txt");
  assert.equal(status, 200);
  for (const line of ["Allow: /", "Disallow: /admin", "Disallow: /mcp", "Disallow: /api/", "Sitemap: ", "/news-sitemap.xml", "User-agent: OAI-SearchBot", "User-agent: Claude-SearchBot", "User-agent: Claude-User"]) assert.ok(text.includes(line), line);
  assert.ok(/^Disallow: \/admin$/m.test(text), "/admin (the only admin entry) is disallowed");
});

await check("sitemap.xml: absolute URLs with lastmod for articles and topics", async () => {
  const { status, headers, text } = await get("/sitemap.xml");
  assert.equal(status, 200);
  assert.match(headers.get("content-type") ?? "", /xml/);
  assert.ok(text.includes(`${BASE}/articles/${slug}`), "article loc");
  assert.ok(text.includes("<lastmod>"), "lastmod present");
  assert.ok(text.includes(`${BASE}/topics/`), "topic loc");
});

await check("news-sitemap.xml: valid news urlset", async () => {
  const { status, text } = await get("/news-sitemap.xml");
  assert.equal(status, 200);
  assert.match(text, /xmlns:news="http:\/\/www\.google\.com\/schemas\/sitemap-news\/0\.9"/);
  if (text.includes("<news:news>")) assert.match(text, /<news:publication_date>/);
});

await check("feed.xml: RSS with the latest published article", async () => {
  const { status, headers, text } = await get("/feed.xml");
  assert.equal(status, 200);
  assert.match(headers.get("content-type") ?? "", /rss\+xml/);
  assert.match(text, /<rss version="2\.0"/);
  assert.ok(text.includes(`${BASE}/articles/${slug}`), "item link");
  assert.match(text, /<pubDate>/);
});

await check("manifest.webmanifest: valid JSON with name + theme color", async () => {
  const { status, text } = await get("/manifest.webmanifest");
  assert.equal(status, 200);
  const m = JSON.parse(text);
  assert.ok(m.name && m.theme_color, "fields");
});

const home = await get("/");
await check("homepage: OG meta + WebSite/Organization JSON-LD + feed discovery", async () => {
  assert.equal(home.status, 200);
  assert.match(home.text, /property="og:title"/);
  assert.match(home.text, /property="og:image"/);
  assert.match(home.text, /application\/rss\+xml/);
  const graphs = jsonLdBlocks(home.text).flatMap((b) => b["@graph"] ?? [b]);
  assert.ok(graphs.some((g) => g["@type"] === "WebSite"), "WebSite");
  assert.ok(graphs.some((g) => g["@type"] === "Organization"), "Organization");
  assert.match(home.text, /max-image-preview:large/);
});

// Find a published article that actually has media images (for alt/cache checks).
async function findArticleWithMedia() {
  const sm = await get("/sitemap.xml");
  const paths = [...sm.text.matchAll(/<loc>[^<]*(\/articles\/[a-z0-9-]+)<\/loc>/g)].map((m) => m[1]).slice(0, 12);
  for (const path of paths) {
    const page = await get(path);
    if (/src="\/media\//.test(page.text)) return page;
  }
  return null;
}
const articlePage = await get(`/articles/${slug}`);
await check("article: absolute canonical, OG article meta, valid NewsArticle + Breadcrumb JSON-LD", async () => {
  assert.equal(articlePage.status, 200);
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(articlePage.text)?.[1];
  assert.ok(canonical?.startsWith(BASE), `canonical absolute: ${canonical}`);
  assert.match(articlePage.text, /property="og:type" content="article"/);
  assert.match(articlePage.text, /property="article:published_time"/);
  const blocks = jsonLdBlocks(articlePage.text);
  const news = blocks.find((b) => b["@type"] === "NewsArticle");
  assert.ok(news, "NewsArticle present");
  assert.ok(news.headline && news.datePublished, "headline+date");
  assert.ok(blocks.some((b) => b["@type"] === "BreadcrumbList"), "BreadcrumbList");
});

await check("article: cover/thumbnail images carry descriptive alt text", async () => {
  const page = (await findArticleWithMedia()) ?? articlePage;
  const imgs = [...page.text.matchAll(/<img[^>]+src="\/media\/[^"]+"[^>]*>/g)].map((m) => m[0]);
  assert.ok(imgs.length > 0, "has media images");
  for (const img of imgs) assert.match(img, /alt="[^"]+"/, img.slice(0, 90));
});

await check("perf (t88): homepage LCP cover is eager/high-priority, cards use thumb variant + dimensions", async () => {
  assert.match(home.text, /class="article-cover"[^>]*loading="eager"[^>]*fetchpriority="high"/i, "lead cover eager + high priority");
  assert.match(home.text, /rel="preload" as="image"[^>]*fetchpriority="high"/i, "LCP preload");
  assert.match(home.text, /variant=thumb/, "card/list images use the thumb variant, not the hero/original");
  for (const img of [...home.text.matchAll(/<img[^>]+src="\/media\/[^"]+"[^>]*>/g)].map((m) => m[0])) {
    if (img.includes("wordmark__logo")) continue; // fixed-height CSS, aspect is owner-uploaded
    assert.match(img, /width="\d+" height="\d+"/, `sized img (CLS): ${img.slice(0, 80)}`);
  }
});

await check("topics index: ItemList JSON-LD of the topics", async () => {
  const { status, text } = await get("/topics");
  assert.equal(status, 200);
  const blocks = jsonLdBlocks(text);
  assert.ok(blocks.some((b) => b["@type"] === "ItemList"), "ItemList");
});

await check("admin entry stays noindex; media files are immutable-cached", async () => {
  const login = await get("/admin");
  assert.match(login.text, /name="robots" content="noindex/);
  const page = (await findArticleWithMedia()) ?? articlePage;
  const mediaSrc = /src="(\/media\/[a-z0-9-]+)"/.exec(page.text)?.[1];
  assert.ok(mediaSrc, "media src");
  const media = await fetch(BASE + mediaSrc, { method: "HEAD" });
  assert.match(media.headers.get("cache-control") ?? "", /immutable/);
});

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

// t74 favicon set: stable root paths, real files, correct types (Google fetches /favicon.ico directly).
{
  const icons = [
    ["/favicon.ico", /icon/],
    ["/favicon.svg", /svg/],
    ["/favicon-16x16.png", /png/],
    ["/favicon-32x32.png", /png/],
    ["/apple-touch-icon.png", /png/],
    ["/android-chrome-192x192.png", /png/],
    ["/android-chrome-512x512.png", /png/],
    ["/logo.png", /png/],
    ["/logo.svg", /svg/],
  ];
  for (const [path, type] of icons) {
    const r = await fetch(BASE + path);
    assert.equal(r.status, 200, `${path} status`);
    assert.match(r.headers.get("content-type") ?? "", type, `${path} content-type`);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.ok(buf.length > 100, `${path} non-trivial bytes`);
    if (path.endsWith(".ico")) assert.ok(buf.readUInt32LE(0) === 0x00010000 || (buf[0] === 0 && buf[1] === 0), "ico header");
    if (path.endsWith(".png")) assert.equal(buf.subarray(1, 4).toString(), "PNG", `${path} png magic`);
  }
  const html = await (await fetch(BASE + "/")).text();
  for (const tag of ['href="/favicon.ico"', 'href="/favicon.svg"', 'href="/favicon-32x32.png"', 'href="/favicon-16x16.png"', 'href="/apple-touch-icon.png"', 'rel="manifest"']) {
    assert.ok(html.includes(tag), `home head includes ${tag}`);
  }
  const loginHtml = await (await fetch(BASE + "/admin")).text();
  assert.ok(loginHtml.includes('href="/favicon.ico"'), "admin sign-in head includes favicon.ico");
  const nf = await (await fetch(BASE + "/no-such-page-favicon")).text();
  assert.ok(nf.includes('href="/favicon.ico"'), "404 head includes favicon.ico");
  const manifest = await (await fetch(BASE + "/manifest.webmanifest")).json();
  assert.ok(manifest.icons.some((i) => i.sizes === "512x512"), "manifest has 512 icon");
  assert.ok(manifest.icons.some((i) => i.sizes === "192x192"), "manifest has 192 icon");
  console.log("ok - favicon set: ico/svg/png sizes + apple-touch + manifest + head tags (t74)");
}
