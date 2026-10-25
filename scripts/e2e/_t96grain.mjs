import { chromium } from "playwright-core";
const BASE = "http://127.0.0.1:8787";
const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox"] });
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3, colorScheme: theme });
  const p = await ctx.newPage();
  await p.goto(BASE + "/articles", { waitUntil: "networkidle" });
  await p.screenshot({ path: `/workspace/t96-shots/p1-active-latest-1440-${theme}.png`, clip: { x: 0, y: 0, width: 1440, height: 120 } });
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await p.locator(".wordmark").screenshot({ path: `/workspace/t96-shots/p1-grain-closeup-stamp-${theme}.png` });
  await p.locator(".trend__label").screenshot({ path: `/workspace/t96-shots/p1-grain-closeup-ticker-${theme}.png` });
  const band = p.locator(".band").first();
  const box = await band.boundingBox();
  await p.screenshot({ path: `/workspace/t96-shots/p1-grain-closeup-band-${theme}.png`, clip: { x: box.x, y: box.y, width: 520, height: 220 }, fullPage: true });
  await ctx.close();
}
await browser.close();
