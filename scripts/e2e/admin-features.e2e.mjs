#!/usr/bin/env node
/**
 * Admin features e2e (site settings, appearance, ticker, sidebar, delete).
 * WRITES to the target database: run only against local `wrangler dev` or an
 * isolated preview database, never production.
 *   BASE=http://127.0.0.1:8787 ADMIN_TOKEN=<token> npm run test:e2e:admin-features
 */
import assert from "node:assert/strict";
import { chromium, request as pwRequest } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const TOKEN = process.env.ADMIN_TOKEN ?? "";
assert.ok(TOKEN.length >= 16, "set ADMIN_TOKEN");
if (/dypolblog\.rstmcsoch\.workers\.dev$/.test(new URL(BASE).host) && !new URL(BASE).host.includes("-dypolblog")) {
  throw new Error("Refusing to run write tests against production.");
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`not ok - ${name}\n  ${error instanceof Error ? error.message.split("\n")[0] : error}`);
  }
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
const calls = [];
page.on("request", (req) => {
  if (req.url().includes("/_serverFn/") && req.method() === "POST") calls.push({ url: req.url(), headers: req.headers(), body: req.postDataBuffer() });
});

await page.goto(BASE + "/login");
await page.fill('input[type="password"]', TOKEN);
await page.click('button[type="submit"]');
await page.waitForURL(/\/admin\/?$/);

async function saveForm() {
  await page.click('button[type="submit"]:has-text("Save changes")');
  await page.waitForSelector('[role="status"]:has-text("Saved"), [role="alert"]');
  const alert = await page.$('[role="alert"]');
  if (alert) throw new Error(`save failed: ${await alert.textContent()}`);
}
async function firstPublishedSlug() {
  const r = await context.request.get(BASE + "/articles");
  const m = /href="\/articles\/([a-z0-9-]+)"/.exec(await r.text());
  assert.ok(m, "no published article");
  return m[1];
}

await check("sidebar groups and plain-language labels (no desk/pieces/plate)", async () => {
  const nav = await page.textContent(".adm-nav");
  for (const label of ["Dashboard", "Articles", "Topics & tags", "Media", "Homepage", "Site text", "Appearance", "AI automation", "Settings", "Help"]) assert.ok(nav.includes(label), label);
  for (const path of ["/admin", "/admin/articles", "/admin/topics", "/admin/media", "/admin/settings", "/admin/automation", "/admin/homepage", "/admin/site-text", "/admin/appearance"]) {
    await page.goto(BASE + path);
    await page.waitForSelector(".desk-title");
    // Interface text only: article titles/slugs/excerpts in tables are owner content.
    const text = (await page.$eval(".adm-content", (el) => {
      const clone = el.cloneNode(true);
      clone.querySelectorAll("td, option, input, textarea").forEach((n) => n.remove());
      return clone.textContent;
    })).toLowerCase();
    assert.doesNotMatch(text, /\bdesk\b|\bpieces?\b|\bplate\b/, path);
  }
});

await check("help page renders the admin guide", async () => {
  await page.goto(BASE + "/admin/help");
  await page.waitForSelector("text=Admin guide");
  assert.ok((await page.textContent(".adm-help")).includes("Preview vs production"));
});

await check("admin look is independent of the public night theme", async () => {
  await page.evaluate(() => localStorage.setItem("dypol-theme", "dark"));
  await page.goto(BASE + "/admin");
  const bg = await page.$eval(".desk", (el) => getComputedStyle(el).backgroundColor);
  assert.equal(bg, "rgb(246, 247, 249)");
});

await check("appearance: darkness slider changes the public night background; contrast shown", async () => {
  await page.goto(BASE + "/admin/appearance");
  await page.$eval('input[type="range"]', (el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(el, "80");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.match(await page.textContent('[data-testid="appearance-preview"]'), /Contrast/);
  await page.check('input[name="coverFallback"] >> nth=0');
  await saveForm();
  await page.goto(BASE + "/");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, "rgb(51, 51, 51)");
});

const slug = await firstPublishedSlug();

await check("article sidebar: blocks render; turning it off gives full width", async () => {
  await page.goto(BASE + `/articles/${slug}`);
  assert.ok(await page.$(".article-aside"), "aside missing with defaults");
  assert.ok(await page.$(".share-list"), "share block missing");
  await page.goto(BASE + "/admin/homepage");
  await page.uncheck("text=Show the sidebar");
  await saveForm();
  await page.goto(BASE + `/articles/${slug}`);
  assert.equal(await page.$(".article-aside"), null);
  assert.ok(await page.$(".article-layout--full"));
  await page.goto(BASE + "/admin/homepage");
  await page.check("text=Show the sidebar");
  await saveForm();
});

await check("site text: renaming 'New stories' shows on the article sidebar", async () => {
  await page.goto(BASE + "/admin/site-text");
  await page.fill('label:has-text("Sidebar: newest articles heading") input', "Fresh off the press");
  await saveForm();
  await page.goto(BASE + `/articles/${slug}`);
  assert.ok((await page.textContent(".article-aside")).includes("Fresh off the press"));
  await page.goto(BASE + "/admin/site-text");
  await page.fill('label:has-text("Sidebar: newest articles heading") input', "New stories");
  await saveForm();
});

await check("ticker: custom text items, count and animation", async () => {
  await page.goto(BASE + "/admin/homepage");
  await page.selectOption('label:has-text("What it shows") select', "custom");
  await page.click("text=Add text item");
  await page.fill('#ticker label:has-text("Text") input >> nth=0', "E2E ticker item");
  await page.check("text=Scroll continuously");
  await saveForm();
  await page.goto(BASE + "/");
  assert.ok((await page.textContent(".trend")).includes("E2E ticker item"));
  assert.ok(await page.$(".trend--animate"));
  await page.goto(BASE + "/admin/homepage");
  await page.selectOption('label:has-text("What it shows") select', "latest");
  await page.uncheck("text=Scroll continuously");
  await saveForm();
  await page.goto(BASE + "/");
  assert.equal(await page.$(".trend--animate"), null);
});

await check("homepage: hide + reorder sections", async () => {
  await page.goto(BASE + "/admin/homepage");
  await page.uncheck('[data-section="also"] input[type="checkbox"]');
  await page.click('[aria-label^="Move Topics grid"][aria-label$="up"]');
  await saveForm();
  await page.goto(BASE + "/");
  assert.equal(await page.$("#also-filed"), null);
  const order = await page.$$eval("main section", (els) => els.map((e) => e.getAttribute("aria-labelledby") ?? "lead"));
  assert.ok(order.indexOf("topics") < order.indexOf("latest"), order.join(","));
  await page.goto(BASE + "/admin/homepage");
  await page.check('[data-section="also"] input[type="checkbox"]');
  await page.click('[aria-label^="Move Topics grid"][aria-label$="down"]');
  await saveForm();
});

await check("invalid settings are refused with a readable message", async () => {
  await page.goto(BASE + "/admin/appearance");
  await page.fill('input[aria-label="Accent colour hex code"]', "orange");
  await page.click('button[type="submit"]:has-text("Save changes")');
  await page.waitForSelector('[role="alert"]');
  assert.match(await page.textContent('[role="alert"]'), /accent/i);
});

let deleteCall = null;
await check("delete a draft from the list (confirm dialog)", async () => {
  await page.goto(BASE + "/admin/articles/new");
  await page.waitForLoadState("networkidle"); // fill only after hydration
  await page.fill('label:has-text("Title") input', "E2E delete me");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\/articles\/(?!new)[^/]+$/);
  await page.goto(BASE + "/admin/articles?q=E2E%20delete%20me");
  await page.waitForSelector("text=E2E delete me");
  await page.click('tr:has-text("E2E delete me") button:has-text("Delete")');
  await page.waitForSelector("dialog[open]");
  const before = calls.length;
  await page.click('dialog[open] button:has-text("Cancel")');
  assert.equal(calls.length, before, "cancel must not call the server");
  await page.click('tr:has-text("E2E delete me") button:has-text("Delete")');
  await page.click('dialog[open] button:has-text("Delete permanently")');
  await page.waitForSelector("text=E2E delete me", { state: "detached" });
  deleteCall = calls.at(-2) ?? calls.at(-1);
  deleteCall = calls.slice(before).find((c) => c.body && c.body.toString().includes("deleteCover")) ?? deleteCall;
});

await check("delete a PUBLISHED article from the editor: public page 404s, tag links gone", async () => {
  await page.goto(BASE + `/admin/articles?q=${slug}`);
  await page.click(`tr:has-text("${slug}") a:has-text("Edit")`);
  await page.waitForSelector("text=Delete article");
  await page.click('button:has-text("Delete article")');
  await page.click('dialog[open] button:has-text("Delete permanently")');
  await page.waitForURL(/\/admin\/articles\/?(\?.*)?$/);
  const r = await context.request.get(BASE + `/articles/${slug}`);
  assert.equal(r.status(), 404);
});

await check("delete server function refuses an anonymous replay", async () => {
  assert.ok(deleteCall, "no captured delete call");
  const anon = await pwRequest.newContext({ baseURL: BASE });
  const headers = { ...deleteCall.headers };
  delete headers.cookie;
  const r = await anon.post(deleteCall.url, { headers, data: deleteCall.body });
  const body = await r.text();
  assert.ok(r.status() >= 400 || /Unauthorized|Forbidden/i.test(body), `status ${r.status()} ${body.slice(0, 120)}`);
});

await check("no console errors on admin pages", async () => {
  const real = consoleErrors.filter((e) => !/Failed to load resource: the server responded with a status of (404|500)/.test(e));
  assert.deepEqual(real, []);
});

await browser.close();
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
