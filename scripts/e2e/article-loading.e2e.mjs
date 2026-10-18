#!/usr/bin/env node
/**
 * Article layout + loading e2e (t56/t57): narrower sidebar column with
 * same-size internals, thumb-left/title-right rows with 2-line clamp,
 * intent prefetch making clicks feel instant, and the article-shaped
 * skeleton (no hatched LOADING) on slow navigations. Read-only.
 *   BASE=http://127.0.0.1:8787 npm run test:e2e:article-loading
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); }
  catch (e) { failures++; console.log(`not ok - ${name}\n  ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
}

const feed = await (await fetch(BASE + "/feed.xml")).text();
const slug = feed.match(/\/articles\/([a-z0-9-]+)/)?.[1];
assert.ok(slug, "need a published article in the feed");

const browser = await chromium.launch();

await check("desktop: sidebar ~25% narrower, article wider, internals same size", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${BASE}/articles/${slug}`, { waitUntil: "domcontentloaded" });
  const m = await page.evaluate(() => {
    const w = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().width : 0; };
    const thumb = document.querySelector(".aside-thumb");
    const title = document.querySelector(".aside-title");
    return {
      aside: w(".article-aside"), body: w(".article-body"),
      thumbW: thumb ? thumb.getBoundingClientRect().width : null,
      titleFont: title ? getComputedStyle(title).fontSize : null,
      clamp: title ? getComputedStyle(title).webkitLineClamp : null,
    };
  });
  assert.ok(m.aside > 0 && m.aside <= 380, `aside ${m.aside}px should be <=380 (was ~494)`);
  assert.ok(m.body >= 700, `body ${m.body}px should be >=700 (was ~594)`);
  if (m.thumbW !== null) assert.equal(m.thumbW, 56, "thumbnail size unchanged (3.5rem)");
  assert.equal(m.clamp, "2", "sidebar titles clamp to 2 lines");
  await page.close();
});

await check("sidebar rows: title sits beside (right of) thumbnail on desktop and mobile", async () => {
  for (const vp of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: vp });
    await page.goto(`${BASE}/articles/${slug}`, { waitUntil: "domcontentloaded" });
    const rel = await page.evaluate(() => {
      const t = document.querySelector(".aside-thumb");
      const s = document.querySelector(".aside-title");
      if (!t || !s) return null;
      const a = t.getBoundingClientRect(), b = s.getBoundingClientRect();
      return { beside: b.x > a.x, sameRow: Math.abs(b.y - a.y) < 4 };
    });
    if (rel) { assert.ok(rel.beside, "title right of thumb"); assert.ok(rel.sameRow, "title on same row"); }
    await page.close();
  }
});

await check("mobile/tablet: sidebar stacks below the article body", async () => {
  for (const vp of [{ width: 390, height: 844 }, { width: 834, height: 1112 }]) {
    const page = await browser.newPage({ viewport: vp });
    await page.goto(`${BASE}/articles/${slug}`, { waitUntil: "domcontentloaded" });
    const order = await page.evaluate(() => {
      const b = document.querySelector(".article-body")?.getBoundingClientRect();
      const a = document.querySelector(".article-aside")?.getBoundingClientRect();
      return a && b ? a.y >= b.y : true;
    });
    assert.ok(order, "aside below body");
    await page.close();
  }
});

await check("prefetch on hover makes the click feel instant; view still counted", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  let serverFnResponses = 0;
  let viewPosted = false;
  page.on("response", (r) => { if (r.url().includes("_serverFn")) serverFnResponses++; });
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/views/")) viewPosted = true; });
  await page.goto(BASE + "/articles", { waitUntil: "domcontentloaded" });
  const href = await page.locator('a[href^="/articles/"]').first().getAttribute("href");
  await page.locator(`a[href="${href}"]`).first().hover();
  await page.waitForTimeout(1500);
  assert.ok(serverFnResponses >= 1, "hover should prefetch the article data");
  const t = Date.now();
  await page.locator(`a[href="${href}"]`).first().click();
  await page.waitForSelector(".article-title", { timeout: 5000 });
  const ms = Date.now() - t;
  assert.ok(ms < 1000, `click->article ${ms}ms should feel instant`);
  assert.equal(await page.locator(".article-skeleton").count(), 0, "no skeleton needed after prefetch");
  await page.waitForTimeout(600);
  assert.ok(viewPosted, "view counter POST still fires");
  await context.close();
});

await check("slow navigation shows the article skeleton, not hatched LOADING", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.route("**/_serverFn/**", async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.continue(); });
  await page.goto(BASE + "/articles", { waitUntil: "domcontentloaded" });
  const href = await page.locator('a[href^="/articles/"]').first().getAttribute("href");
  await page.locator(`a[href="${href}"]`).first().click();
  await page.waitForSelector(".article-skeleton", { timeout: 4000 });
  assert.equal(await page.locator(".article-skeleton").getAttribute("aria-busy"), "true");
  const bg = await page.locator(".article-skeleton .skeleton").first().evaluate((e) => getComputedStyle(e).backgroundImage);
  assert.ok(!String(bg).includes("repeating-linear-gradient"), "skeleton must not use hatched bars");
  await page.waitForSelector(".article-title", { timeout: 8000 });
  await context.close();
});

await check("direct article HTML still carries SEO meta + JSON-LD (SSR intact)", async () => {
  const html = await (await fetch(`${BASE}/articles/${slug}`)).text();
  assert.ok(html.includes('rel="canonical"'), "canonical");
  assert.ok(html.includes("application/ld+json"), "JSON-LD");
  assert.ok(html.includes("article-title"), "server-rendered article");
});

await browser.close();
console.log(failures === 0 ? "article-loading e2e: all ok" : `article-loading e2e: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
