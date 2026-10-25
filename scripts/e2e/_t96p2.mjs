import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox"] });
for (const theme of ["light", "dark"]) for (const w of [1440, 390]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: w === 390 ? 2 : 1, colorScheme: theme });
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:8787/", { waitUntil: "networkidle" });
  await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } scrollTo(0, 0); });
  await p.waitForTimeout(500);
  await p.screenshot({ path: `/workspace/t96-shots/p2-home-${w}-${theme}.png`, fullPage: true });
  if (w === 1440) {
    const blocks = await p.evaluate(() => [...document.querySelectorAll("[data-block]")].map(e => e.dataset.block));
    console.log(theme, blocks.join(","));
    for (const sel of ["river", "topicRows", "quickReads"]) { const l = p.locator(`[data-block=${sel}]`).first(); if (await l.count()) await l.screenshot({ path: `/workspace/t96-shots/p2-section-${sel}-${theme}.png` }); }
  }
  await ctx.close();
}
await browser.close();
