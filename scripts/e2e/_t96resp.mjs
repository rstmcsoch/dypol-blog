/**
 * t73 responsive overflow audit (regression gate).
 *
 * Loads every public route at many viewport widths (including odd
 * multitasking sizes) and asserts ZERO horizontal overflow: neither the
 * document nor any visible element may extend past the viewport's right
 * edge. The pre-t73 bug: a long unbroken Sources URL sized the article
 * grid track past the viewport while `overflow-x: clip` hid the scroll —
 * text was silently cut off. This script checks element geometry, not
 * just document scrollWidth, so that class of bug fails loudly.
 *
 * Usage: BASE_URL=http://localhost:8787 ARTICLE=/articles/<slug> node scripts/e2e/responsive.e2e.mjs
 * Defaults target a local dev server with the seeded/synthetic article.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:8787";
const ARTICLE = process.env.ARTICLE ?? "/articles/t73-responsive-test";
const ROUTES = [
  "/", "/index", "/topics", "/topics/artificial-intelligence-ai-tools", ARTICLE,
  "/about", "/contact", "/privacy-policy", "/terms", "/dmca", "/cookie-policy",
  "/editorial-policy", "/corrections-policy", "/disclaimer",
  "/this-page-does-not-exist", "/login",
];
const WIDTHS = [320, 360, 390, 414, 480, 517, 600, 731, 768, 834, 977, 1024, 1280, 1440, 1920];

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext();
const failures = [];
for (const route of ROUTES) {
  for (const w of WIDTHS) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(BASE + route, { waitUntil: "load", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(200);
    const data = await page.evaluate(() => {
      const iw = window.innerWidth;
      const offenders = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > iw + 2) {
          offenders.push(`${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? "." + el.className.split(" ").slice(0, 2).join(".") : ""} right=${Math.round(r.right)} (+${Math.round(r.right - iw)})`);
          if (offenders.length >= 4) break;
        }
      }
      return { doc: document.documentElement.scrollWidth - iw, offenders };
    });
    if (data.doc > 1 || data.offenders.length) failures.push({ route, w, ...data });
    await page.close();
  }
}
await browser.close();
console.log(`responsive audit: ${ROUTES.length * WIDTHS.length} route×width combos, ${failures.length} failing`);
for (const f of failures.slice(0, 20)) console.log("FAIL", f.route, f.w, "docOver=" + f.doc, f.offenders.join(" | "));
process.exit(failures.length ? 1 : 0);
