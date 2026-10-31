#!/usr/bin/env node
/**
 * Standard pages e2e (t52): public render of the nine pages, footer links,
 * sitemap inclusion, admin Pages CRUD (create/edit/hide/delete), hidden
 * pages 404, reserved-slug rejection. WRITES to the target DB: local only.
 *   BASE=http://127.0.0.1:8787 ADMIN_TOKEN=<token> npm run test:e2e:pages
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const TOKEN = process.env.ADMIN_TOKEN ?? "";
assert.ok(TOKEN.length >= 16, "set ADMIN_TOKEN");
if ((/^blog\.dypol\.workers\.dev$/.test(new URL(BASE).host) || /dypolblog\.rstmcsoch\.workers\.dev$/.test(new URL(BASE).host))) throw new Error("Refusing to run write tests against production.");

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); }
  catch (e) { failures++; console.log(`not ok - ${name}\n  ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
}
const get = async (path) => { const r = await fetch(BASE + path); return { status: r.status, text: await r.text() }; };

const PAGES = ["about", "privacy-policy", "terms", "dmca", "cookie-policy", "editorial-policy", "corrections-policy", "contact", "disclaimer"];

await check("all nine standard pages render publicly with real copy", async () => {
  for (const slug of PAGES) {
    const { status, text } = await get(`/${slug}`);
    assert.equal(status, 200, slug);
    const visible = text.replace(/<script[\s\S]*?<\/script>/g, "");
    assert.ok(!visible.includes("sample pieces") && !visible.includes("white day"), `${slug} still has old copy`);
  }
  const about = await get("/about");
  assert.match(about.text, /About Us/);
  assert.match(about.text, /human editor/);
  assert.match(about.text, /artificial intelligence/i);
  const privacy = await get("/privacy-policy");
  assert.match(privacy.text, /Privacy Policy/);
  assert.match(privacy.text, /18 October 2026|18 Oct/);
});

await check("footer links every standard page; sitemap includes them", async () => {
  const home = await get("/");
  for (const slug of PAGES) assert.ok(home.text.includes(`href="/${slug}"`), `footer missing /${slug}`);
  const sm = await get("/sitemap.xml");
  for (const slug of PAGES) assert.ok(sm.text.includes(`${BASE}/${slug}`), `sitemap missing /${slug}`);
});

await check("unknown slug still 404s (dynamic page route does not swallow)", async () => {
  const { status } = await get("/definitely-not-a-page-t52");
  assert.equal(status, 404);
});

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE + "/login");
await page.fill('input[type="password"]', TOKEN);
await page.click('button[type="submit"]');
await page.waitForURL(/\/admin\/?$/);

await check("admin: Pages desk lists the standard pages", async () => {
  await page.goto(BASE + "/admin/pages");
  await page.waitForSelector("text=Privacy Policy");
  const body = await page.textContent("body");
  for (const t of ["About Us", "DMCA / Copyright Policy", "Editorial Policy", "standard"]) assert.ok(body.includes(t), t);
});

await check("admin: create, hide, show, delete a custom page end-to-end", async () => {
  await page.fill('label:has-text("Title") input', "Test Page T52");
  await page.fill('label:has-text("Slug") input', "test-page-t52");
  await page.fill('textarea', "## Hello\n\nA short test page body for t52.");
  await page.click('button:has-text("Create page")');
  await page.waitForSelector('[role="status"]:has-text("Page created")');
  const pub = await get("/test-page-t52");
  assert.equal(pub.status, 200);
  assert.match(pub.text, /A short test page body/);
  // hide via edit
  const card = page.locator(".block-card", { hasText: "test-page-t52" });
  await card.locator('button:has-text("Edit")').click();
  await page.selectOption('label:has-text("Status") select', "hidden");
  await page.click('button:has-text("Save page")');
  await page.waitForSelector('[role="status"]:has-text("Page saved")');
  assert.equal((await get("/test-page-t52")).status, 404, "hidden page must 404");
  // delete
  const card2 = page.locator(".block-card", { hasText: "test-page-t52" });
  await card2.locator('button:has-text("Delete")').click();
  await card2.locator('button:has-text("Confirm delete")').click();
  await page.waitForSelector('[role="status"]:has-text("Page deleted")');
  assert.equal((await get("/test-page-t52")).status, 404);
});

await check("admin: reserved slug is rejected with a clear error", async () => {
  await page.goto(BASE + "/admin/pages");
  await page.fill('label:has-text("Title") input', "Articles Clone");
  await page.fill('label:has-text("Slug") input', "articles");
  await page.fill('textarea', "Should never save.");
  await page.click('button:has-text("Create page")');
  await page.waitForSelector('[role="alert"]');
  const alert = await page.textContent('[role="alert"]');
  assert.match(alert ?? "", /used by the site/);
});

await browser.close();
console.log(failures === 0 ? "pages e2e: all ok" : `pages e2e: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
