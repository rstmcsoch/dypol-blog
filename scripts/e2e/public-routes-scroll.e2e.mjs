// Usage: node scripts/e2e/public-routes-scroll.e2e.mjs <base>   (t216: Back to top on public routes, not admin; route changes not animated)
import { chromium } from "playwright";
const base = process.argv[2];
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 1024, height: 768 } })).newPage();
const res = {};
for (const path of ["/", "/articles", "/topics", "/about", "/contact", "/privacy-policy", "/search"]) {
  await p.goto(base + path, { waitUntil: "domcontentloaded" });
  res[path] = await p.evaluate(() => !!document.querySelector(".back-to-top") && !!document.querySelector(".back-to-top__sentinel"));
}
await p.goto(base + "/articles", { waitUntil: "networkidle" });
await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
await p.waitForTimeout(300);
const link = p.locator('main a[href^="/articles/"]').last();
await link.click();
await p.waitForTimeout(60);
res.routeScrollAfter60ms = await p.evaluate(() => ({ y: scrollY, path: location.pathname, smoothClass: document.documentElement.className.includes("is-smooth-scrolling") }));
const a = await (await b.newContext()).newPage();
await a.goto(base + "/admin", { waitUntil: "domcontentloaded" });
res.adminHasButton = await a.evaluate(() => !!document.querySelector(".back-to-top"));
console.log(JSON.stringify(res));
await b.close();
