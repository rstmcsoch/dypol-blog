import { chromium } from "playwright-core";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8787";
const OUT = process.env.OUT || "/workspace/t96-shots";
const PREFIX = process.env.PREFIX || "p1";
const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox"] });
async function page(width, height, theme) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: theme });
  const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  return { ctx, p };
}
const themes = (process.env.THEMES || "light,dark").split(",");
for (const theme of themes) {
  let { ctx, p } = await page(1440, 900, theme);
  await p.screenshot({ path: `${OUT}/${PREFIX}-header-1440-${theme}.png`, clip: { x: 0, y: 0, width: 1440, height: 260 } });
  await p.hover(".site-nav .nav-link >> nth=1").catch(() => {});
  await p.screenshot({ path: `${OUT}/${PREFIX}-header-1440-hover-${theme}.png`, clip: { x: 0, y: 0, width: 1440, height: 260 } });
  await p.screenshot({ path: `${OUT}/${PREFIX}-home-1440-${theme}.png`, fullPage: true });
  await ctx.close();
  ({ ctx, p } = await page(390, 844, theme));
  await p.screenshot({ path: `${OUT}/${PREFIX}-header-390-closed-${theme}.png` });
  await p.click(".menu-btn");
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/${PREFIX}-header-390-open-${theme}.png` });
  await ctx.close();
}
await browser.close();
