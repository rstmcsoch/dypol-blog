// Visual smoke: BASE=<url> TAG=<name> OUT=<dir> node scripts/e2e/visual-smoke.mjs
// Screenshots 6 pages at 4 viewports and reports failed requests / console errors.
import { chromium } from "playwright";
const BASE = process.env.BASE; const tag = process.env.TAG ?? "site"; const OUT = process.env.OUT ?? "/workspace/pr2-shots";
const pages = { home: "/", article: "/articles/quiet-architecture-of-a-page", topics: "/topics", topic: null, about: "/about", login: "/admin" };
const vps = { "mobile-portrait": [390, 844], "mobile-landscape": [844, 390], tablet: [820, 1180], desktop: [1440, 900] };
const browser = await chromium.launch();
const report = [];
{ const p = await browser.newPage(); await p.goto(BASE + "/topics"); pages.topic = await p.locator('a[href^="/topics/"]').first().getAttribute("href"); await p.close(); }
for (const [vp, [w, h]] of Object.entries(vps)) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: vp.startsWith("mobile"), hasTouch: vp !== "desktop" });
  for (const [name, path] of Object.entries(pages)) {
    const page = await ctx.newPage();
    const bad = [], errs = [];
    page.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    page.on("requestfailed", (r) => bad.push(`FAILED ${r.url()} ${r.failure()?.errorText}`));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message.slice(0, 200)));
    const resp = await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const info = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      const sheets = [...document.styleSheets].map((s) => { try { return s.cssRules.length; } catch { return -1; } });
      return { font: cs.fontFamily.slice(0, 60), bg: cs.backgroundColor, sheets, fontsLoaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family), hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1, title: document.title };
    });
    const file = `${OUT}/${tag}-${vp}-${name}.png`;
    await page.screenshot({ path: file, fullPage: false });
    report.push({ vp, name, url: page.url().replace(BASE, ""), status: resp?.status(), ...info, bad, errs });
    await page.close();
  }
  await ctx.close();
}
await browser.close();
for (const r of report) console.log(JSON.stringify(r));
