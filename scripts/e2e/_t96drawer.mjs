import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext();
const fails = [];
for (const route of ["/", "/topics", "/about", "/articles"]) for (const w of [320, 360, 390, 414, 480, 600, 768, 834, 959]) {
  const p = await ctx.newPage(); await p.setViewportSize({ width: w, height: 700 });
  await p.goto("http://127.0.0.1:8787" + route, { waitUntil: "load" }); await p.click(".menu-btn"); await p.waitForTimeout(400);
  const r = await p.evaluate(() => { const iw = innerWidth; const off = []; for (const el of document.querySelectorAll("header *")) { const b = el.getBoundingClientRect(); if (b.width && b.right > iw + 0.5) off.push(el.className + " " + b.right); } const nav = document.getElementById("site-nav"); const nb = nav.getBoundingClientRect(); return { off, sw: document.documentElement.scrollWidth, iw, navBottom: nb.bottom, vh: innerHeight, expanded: document.querySelector(".menu-btn").getAttribute("aria-expanded"), focus: document.activeElement?.textContent?.trim().slice(0,20) }; });
  if (r.off.length || r.sw > r.iw || r.navBottom > r.vh + 1 || r.expanded !== "true") fails.push({ route, w, ...r });
  await p.keyboard.press("Escape"); const after = await p.evaluate(() => [document.querySelector(".menu-btn").getAttribute("aria-expanded"), document.activeElement?.className]);
  if (after[0] !== "false" || !String(after[1]).includes("menu-btn")) fails.push({ route, w, esc: after });
  await p.close();
}
console.log(fails.length ? JSON.stringify(fails, null, 1) : "drawer audit: 36 combos, 0 failing");
await browser.close();
