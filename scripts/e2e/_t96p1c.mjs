import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox"] });
const O = "/workspace/t96-shots";
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: theme });
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:8787/", { waitUntil: "networkidle" });
  await p.locator(".wordmark").screenshot({ path: `${O}/p1c-stamp-${theme}.png` });
  await p.locator(".trend__label").screenshot({ path: `${O}/p1c-ticker-${theme}.png` });
  const band = p.locator(".band").first();
  await band.scrollIntoViewIfNeeded();
  const b = await band.boundingBox();
  await p.screenshot({ path: `${O}/p1c-band-${theme}.png`, clip: { x: b.x, y: b.y, width: 640, height: Math.min(260, b.height) } });
  await p.screenshot({ path: `/tmp/p1c-zsrc-${theme}.png`, clip: { x: b.x + 8, y: b.y + 8, width: 100, height: 60 } });
  await ctx.close();
}
await browser.close();
