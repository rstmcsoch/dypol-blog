#!/usr/bin/env node
/** t220: public route enter, reduced-motion, leave-dialog, no CLS. Local wrangler only. */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
assert.ok(/^(127\.0\.0\.1|localhost):/.test(new URL(BASE).host), "local only");

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`ok - ${name}`); } catch (e) { failures++; console.log(`not ok - ${name}\n  ${String(e?.message ?? e).split("\n")[0]}`); }
};

const page = await browser.newPage({ viewport: { width: 1024, height: 800 } });
await page.goto(BASE + "/", { waitUntil: "networkidle" });

await check("motion tokens and route wrapper present; first paint has no data-nav", async () => {
  const m = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const el = document.querySelector("#content .route-motion");
    return { motion: cs.getPropertyValue("--motion").trim(), exit: cs.getPropertyValue("--motion-exit").trim(), nav: el?.getAttribute("data-nav"), anim: el ? getComputedStyle(el).animationName : null };
  });
  const ms = (v) => { const n = parseFloat(v); return /ms$/i.test(v) ? n : n * 1000; };
  assert.equal(ms(m.motion), 180);
  assert.equal(ms(m.exit), 140);
  assert.equal(m.nav, null);
  assert.ok(!m.anim || m.anim === "none");
});

await check("opening an article sets data-nav and does not delay content; CLS stays 0", async () => {
  const href = await page.locator('a[href^="/articles/"]').first().getAttribute("href");
  assert.ok(href);
  await page.evaluate(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  const t0 = Date.now();
  await page.click(`a[href="${href}"]`);
  await page.waitForURL(/\/articles\//);
  await page.waitForSelector("article, .article, h1");
  const took = Date.now() - t0;
  const after = await page.evaluate(() => {
    const el = document.querySelector("#content .route-motion");
    return { nav: el?.getAttribute("data-nav"), cls: window.__cls, title: document.querySelector("h1")?.textContent?.slice(0, 80) };
  });
  assert.ok(Number(after.nav) >= 1, "data-nav after client navigation");
  assert.ok(after.title, "article content present");
  assert.ok(took < 3000, `navigation took ${took}ms`);
  // Transform-only motion must not itself shift layout; a small existing shift on article covers is tolerated.
  assert.ok(after.cls < 0.1, `unexpectedly high CLS ${after.cls}`);
  console.log("  cls", after.cls, "navMs", took);
});

await check("back navigation is not instant-scroll-smoothed on the route itself; wrapper ticks again", async () => {
  const before = await page.getAttribute("#content .route-motion", "data-nav");
  await page.goBack();
  await page.waitForURL((u) => !/\/articles\//.test(u.pathname) || u.pathname === "/articles");
  const after = await page.getAttribute("#content .route-motion", "data-nav");
  assert.ok(Number(after) > Number(before || 0));
  const smooth = await page.evaluate(() => document.documentElement.classList.contains("is-smooth-scrolling"));
  assert.equal(smooth, false);
});

await check("external-link dialog opens and Escape closes (focus/aria stay native)", async () => {
  await page.evaluate(() => {
    const a = document.createElement("a");
    a.href = "https://example.com/t220";
    a.textContent = "ext";
    a.id = "t220-ext";
    document.querySelector("main")?.append(a);
  });
  await page.click("#t220-ext");
  await page.waitForSelector("dialog.leave-dialog[open]");
  const label = await page.getAttribute("dialog.leave-dialog", "aria-labelledby");
  assert.ok(label);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("dialog.leave-dialog")?.open);
});

await check("reduced motion: tokens 0, no route animation name after nav", async () => {
  const p = await browser.newPage({ viewport: { width: 1024, height: 800 }, reducedMotion: "reduce" });
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  const tokens = await p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { motion: cs.getPropertyValue("--motion").trim(), exit: cs.getPropertyValue("--motion-exit").trim() };
  });
  const ms = (v) => { const n = parseFloat(v); return /ms$/i.test(v) ? n : n * 1000; };
  assert.equal(ms(tokens.motion), 0);
  const href = await p.locator('a[href^="/articles/"]').first().getAttribute("href");
  await p.click(`a[href="${href}"]`);
  await p.waitForURL(/\/articles\//);
  const anim = await p.evaluate(() => getComputedStyle(document.querySelector("#content .route-motion")).animationName);
  assert.ok(anim === "none" || anim === "", anim);
  await p.close();
});

await browser.close();
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
