/**
 * t112 mobile menu overlay regression gate.
 *
 * Bug: opening the phone menu after scrolling left the panel (and the
 * Close button) off-screen or cut off, and the page stuck non-clickable.
 * This opens the menu at several scroll positions and widths, plus a live
 * window resize across the desktop breakpoint, and asserts: Close is visible
 * and hit-testable inside the viewport, the panel fits the viewport, Close
 * and Esc work, the scroll position is restored, and the page is clickable.
 * Also checks the external-link "leaving" dialog after scrolling.
 *
 * Usage: BASE_URL=http://localhost:8787 ARTICLE=/articles/<slug> node scripts/e2e/menu-overlay.e2e.mjs
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:8787";
const ARTICLE = process.env.ARTICLE ?? "/articles/t73-responsive-test";
const WIDTHS = (process.env.WIDTHS ?? "320,360,390,414,768,1024,1280").split(",").map(Number);
const SCROLLS = [0, 300, 1500, "bottom"];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome", args: ["--no-sandbox"] });
const failures = [];
let checks = 0;
const fail = (msg) => { failures.push(msg); console.log("FAIL", msg); };
const wait = (p, ms) => p.waitForTimeout(ms);
// Tap the menu button where it is on screen, like a finger would (locator.click()
// would first scroll the sticky button "into view" and move the page itself).
async function tapMenu(page) {
  const box = await page.locator(".menu-btn").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function scrollTo(page, target) {
  await page.evaluate((t) => window.scrollTo({ top: t === "bottom" ? document.documentElement.scrollHeight : t, behavior: "instant" }), target);
  await wait(page, 150);
  return page.evaluate(() => Math.round(window.scrollY));
}

/** Is the page usable: nothing overlay-ish on top, no lock left behind. */
async function assertClickable(page, label) {
  const r = await page.evaluate(() => {
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    const nav = document.getElementById("site-nav");
    const body = document.body;
    return {
      inNav: !!(hit && nav && nav.contains(hit) && getComputedStyle(nav).position === "fixed"),
      navVisible: nav ? getComputedStyle(nav).visibility === "visible" && getComputedStyle(nav).position === "fixed" : false,
      locked: document.documentElement.classList.contains("nav-open") || body.style.position === "fixed" || getComputedStyle(body).overflow === "hidden",
      hit: hit ? hit.tagName + "." + hit.className : "none",
      dialog: !!document.querySelector("dialog[open]"),
    };
  });
  checks++;
  if (r.inNav || r.navVisible || r.locked || r.dialog) fail(`${label}: page not clickable ${JSON.stringify(r)}`);
}

async function openAndCheck(page, label) {
  const btn = page.locator(".menu-btn");
  if (!(await btn.isVisible())) return false;
  await tapMenu(page);
  await wait(page, 350);
  const r = await page.evaluate(() => {
    const b = document.querySelector(".menu-btn").getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    const nav = document.getElementById("site-nav");
    const n = nav.getBoundingClientRect();
    const inner = nav.querySelector(".site-nav__inner");
    const link = nav.querySelector("a");
    const l = link.getBoundingClientRect();
    const linkHit = document.elementFromPoint(l.left + 10, l.top + l.height / 2);
    return {
      btn: [b.top, b.bottom, b.left, b.right], vw: innerWidth, vh: innerHeight,
      btnHit: !!(hit && hit.closest(".menu-btn")),
      nav: [n.top, n.bottom], navVis: getComputedStyle(nav).visibility,
      linkHit: !!(linkHit && nav.contains(linkHit)),
      innerScrollable: inner.scrollHeight <= inner.clientHeight + 1 || ["auto", "scroll"].includes(getComputedStyle(inner).overflowY),
    };
  });
  checks++;
  const ok = r.btn[0] >= 0 && r.btn[1] <= r.vh && r.btn[2] >= 0 && r.btn[3] <= r.vw && r.btnHit
    && r.navVis === "visible" && r.nav[0] >= 0 && r.nav[0] < r.vh / 2 && r.nav[1] <= r.vh + 1 && r.linkHit && r.innerScrollable;
  if (!ok) fail(`${label}: open state wrong ${JSON.stringify(r)}`);
  return true;
}

async function runPage(page, route, width) {
  await page.setViewportSize({ width, height: width >= 768 ? 900 : 760 });
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  for (const s of SCROLLS) {
    const label = `${route} @${width} scroll=${s}`;
    const y0 = await scrollTo(page, s);
    if (!(await openAndCheck(page, label))) { await assertClickable(page, label + " (desktop)"); continue; }
    await tapMenu(page);
    await wait(page, 300);
    const y1 = await page.evaluate(() => Math.round(window.scrollY));
    checks++;
    if (Math.abs(y1 - y0) > 2) fail(`${label}: scroll not restored after Close ${y0} -> ${y1}`);
    await assertClickable(page, label + " after Close");
    // Esc closes too.
    await openAndCheck(page, label + " (reopen)");
    await page.keyboard.press("Escape");
    await wait(page, 300);
    const y2 = await page.evaluate(() => Math.round(window.scrollY));
    checks++;
    if (Math.abs(y2 - y0) > 2) fail(`${label}: scroll not restored after Esc ${y0} -> ${y2}`);
    await assertClickable(page, label + " after Esc");
  }
}

const ctx = await browser.newContext();
const page = await ctx.newPage();
for (const route of ["/", ARTICLE]) for (const w of WIDTHS) await runPage(page, route, w);

// Navigation from the menu closes it, unlocks, and lands at the new page's top.
await page.setViewportSize({ width: 390, height: 760 });
await page.goto(BASE + ARTICLE, { waitUntil: "networkidle" });
await scrollTo(page, 1500);
await openAndCheck(page, "route-change");
await page.locator("#site-nav a").first().click();
await page.waitForLoadState("networkidle");
await wait(page, 400);
await assertClickable(page, "after menu navigation");

// Live window resize: 1440 -> 360 -> 1440 with the menu open across the breakpoint.
for (const route of ["/", ARTICLE]) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  for (let w = 1440; w >= 360; w -= 120) { await page.setViewportSize({ width: w, height: 800 }); await wait(page, 60); }
  await page.setViewportSize({ width: 360, height: 800 });
  for (const s of [300, 1500, "bottom"]) {
    const y0 = await scrollTo(page, s);
    await openAndCheck(page, `resize ${route} 360 scroll=${s}`);
    for (let w = 360; w <= 1440; w += 120) { await page.setViewportSize({ width: w, height: 800 }); await wait(page, 60); }
    await wait(page, 300);
    await assertClickable(page, `resize ${route} widened to 1440 scroll=${s}`);
    const y1 = await page.evaluate(() => Math.round(window.scrollY));
    checks++;
    if (s !== "bottom" && Math.abs(y1 - y0) > 40) fail(`resize ${route} scroll=${s}: scroll lost ${y0} -> ${y1}`);
    for (let w = 1440; w >= 360; w -= 120) { await page.setViewportSize({ width: w, height: 800 }); await wait(page, 60); }
    await page.setViewportSize({ width: 360, height: 800 });
    await wait(page, 200);
    await assertClickable(page, `resize ${route} back to 360 scroll=${s}`);
  }
}

// External-link dialog after scrolling.
for (const w of [390, 1280]) {
  await page.setViewportSize({ width: w, height: 760 });
  await page.goto(BASE + ARTICLE, { waitUntil: "networkidle" });
  const ext = page.locator("article a[href^='http']").filter({ hasNotText: /^$/ });
  const n = await ext.count();
  let found = null;
  for (let i = 0; i < n; i++) {
    const href = await ext.nth(i).getAttribute("href");
    if (href && !href.includes(new URL(BASE).host)) { found = ext.nth(i); break; }
  }
  if (!found) { console.log(`(no external link on ${ARTICLE}, dialog check skipped @${w})`); continue; }
  await found.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -100));
  const y0 = await page.evaluate(() => Math.round(window.scrollY));
  await found.click();
  await wait(page, 400);
  const d = await page.evaluate(() => {
    const dlg = document.querySelector("dialog[open]");
    if (!dlg) return null;
    const r = dlg.getBoundingClientRect();
    const btn = dlg.querySelector("button");
    const b = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { top: r.top, bottom: r.bottom, vh: innerHeight, btnHit: !!(hit && dlg.contains(hit)) };
  });
  checks++;
  if (!d || d.top < 0 || d.bottom > d.vh + 1 || !d.btnHit) fail(`leave dialog @${w}: ${JSON.stringify(d)}`);
  await page.keyboard.press("Escape");
  await wait(page, 300);
  const y1 = await page.evaluate(() => Math.round(window.scrollY));
  checks++;
  if (Math.abs(y1 - y0) > 2) fail(`leave dialog @${w}: scroll moved ${y0} -> ${y1}`);
  await assertClickable(page, `leave dialog @${w} closed`);
}

await browser.close();
console.log(`${checks} checks, ${failures.length} failures`);
process.exit(failures.length ? 1 : 0);
