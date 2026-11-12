import { chromium } from "playwright";
// Usage: node scripts/e2e/back-to-top.e2e.mjs <base> <path> [toc]   (t215/t216)
const base = process.argv[2]; const path = process.argv[3]; const toc = process.argv[4] === "toc";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const out = {};
for (const [name, vp, reduced] of [["phone", { width: 390, height: 844 }, false], ["tablet", { width: 1024, height: 768 }, false], ["wide", { width: 1440, height: 900 }, false], ["landscape", { width: 844, height: 390 }, false], ["reduced", { width: 1024, height: 768 }, true]]) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: reduced ? "reduce" : "no-preference", colorScheme: name === "wide" ? "dark" : "light" });
  const page = await ctx.newPage();
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.querySelectorAll(".consent-bar,.ad-consent").forEach((e) => e.remove()));
  const r = {};
  const vis = () => page.evaluate(() => { const b = document.querySelector(".back-to-top"); const s = getComputedStyle(b); return { shown: b.classList.contains("is-shown"), vis: s.visibility, pe: s.pointerEvents, tab: b.tabIndex, label: b.getAttribute("aria-label") }; });
  r.top = await vis();
  if (toc) {
    const link = page.locator(".toc__list a").last();
    if (await page.locator(".toc__toggle").isVisible()) await page.click(".toc__toggle");
    const href = await link.getAttribute("href");
    const y0 = await page.evaluate(() => scrollY);
    await link.click();
    await page.waitForTimeout(120);
    const mid = await page.evaluate(() => scrollY);
    await page.waitForTimeout(1600);
    const end = await page.evaluate(() => scrollY);
    const info = await page.evaluate((h) => { const el = document.querySelector(h); const hd = document.querySelector(".site-header").getBoundingClientRect(); return { hash: location.hash, headingTop: Math.round(el.getBoundingClientRect().top), headerBottom: Math.round(hd.bottom), cls: document.documentElement.className.includes("is-smooth-scrolling") }; }, href);
    r.toc = { href, y0, mid, end, animated: mid > y0 && mid < end, ...info };
    await page.goBack(); await page.waitForTimeout(400); r.back = await page.evaluate(() => ({ hash: location.hash, y: scrollY }));
    await page.goForward(); await page.waitForTimeout(400); r.forward = await page.evaluate(() => ({ hash: location.hash, y: scrollY }));
  }
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(500);
  r.bottom = await vis();
  const y1 = await page.evaluate(() => scrollY);
  const box = await page.locator(".back-to-top").boundingBox();
  r.box = box && { right: Math.round(vp.width - box.x - box.width), bottom: Math.round(vp.height - box.y - box.height), w: Math.round(box.width) };
  await page.click(".back-to-top");
  await page.waitForTimeout(120);
  const ym = await page.evaluate(() => scrollY);
  await page.waitForTimeout(1600);
  r.up = { y1, mid: ym, end: await page.evaluate(() => scrollY), animated: ym > 0 && ym < y1, focus: await page.evaluate(() => document.activeElement?.id), cls: await page.evaluate(() => document.documentElement.className.includes("is-smooth-scrolling")) };
  r.afterUp = await vis();
  out[name] = r;
  await ctx.close();
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
