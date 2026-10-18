/**
 * t74: render the committed favicon/PWA icon set from the brand SVGs.
 * Chromium renders each SVG at exact pixel sizes; PIL (python3) assembles
 * the multi-size favicon.ico. Run: node scripts/generate-favicons.mjs
 * (requires python3 + PIL for the .ico step). Outputs land in public/ at
 * STABLE root paths — never hashed — so Google/Bing can rely on them.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const browser = await chromium.launch();
async function render(svg, out, w, h = w) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto("file://" + path.join(pub, svg));
  await page.locator("svg").screenshot({ path: path.join(pub, out), omitBackground: false });
  await page.close();
  console.log(out, `${w}x${h}`);
}
await render("favicon.svg", "favicon-16x16.png", 16);
await render("favicon.svg", "favicon-32x32.png", 32);
await render("favicon.svg", "apple-touch-icon.png", 180);
await render("favicon.svg", "android-chrome-192x192.png", 192);
await render("favicon.svg", "android-chrome-512x512.png", 512);
await render("favicon.svg", "icon-512.png", 512);
await render("logo.svg", "logo.png", 1056, 256);
await browser.close();
execFileSync("python3", ["-c", `
from PIL import Image
imgs = [Image.open(f"${pub}/favicon-32x32.png").resize((s, s), Image.LANCZOS) for s in (48, 32, 16)]
imgs[0].save(f"${pub}/favicon.ico", format="ICO", sizes=[(48,48),(32,32),(16,16)], append_images=imgs[1:])
print("favicon.ico written")
`]);
