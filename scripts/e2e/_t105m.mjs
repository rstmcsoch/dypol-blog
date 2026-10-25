import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
for (let i = 0; i < 25; i++) {
  await p.goto("https://dypolblog.rstmcsoch.workers.dev/articles/amazon-aws-capacity-sold-out-through-2027-jassy?v=" + Date.now(), { waitUntil: "load" });
  const m = await p.evaluate(() => {
    const h = document.querySelector(".article-title"), l = document.querySelector(".article-top .lede");
    const r = document.createRange(); r.selectNodeContents(h);
    const lines = [...r.getClientRects()].map((x) => Math.round(x.width));
    return { tw: getComputedStyle(h).textWrap, h1: Math.round(h.getBoundingClientRect().width), lede: Math.round(l.getBoundingClientRect().width), lines };
  });
  if (m.tw && !m.tw.includes("balance")) { console.log(JSON.stringify(m)); await p.screenshot({ path: "/workspace/t96-shots/live-article-1440.png" }); break; }
  if (i === 24) console.log("still old", JSON.stringify(m));
  await new Promise((r) => setTimeout(r, 15000));
}
await b.close();
