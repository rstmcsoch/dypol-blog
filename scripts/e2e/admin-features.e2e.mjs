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
await page.waitForLoadState("networkidle");
await page.fill('input[type="password"]', TOKEN);
await page.click('button[type="submit"]');
await page.waitForURL(/\/admin\/?$/, { waitUntil: "commit" }).catch(async () => { throw new Error("login failed at " + page.url() + ": " + (await page.textContent("main"))?.slice(0, 200)); });

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
  for (const path of ["/admin", "/admin/articles", "/admin/topics", "/admin/media", "/admin/settings", "/admin/automation", "/admin/homepage", "/admin/site-text", "/admin/appearance", "/admin/ticker"]) {
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
  assert.equal(bg, "rgb(244, 246, 251)");
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

await check("ticker: own admin page in nav; rotate (default), scroll, custom items, pinned fallback", async () => {
  await page.goto(BASE + "/admin");
  await page.click('.adm-nav a:has-text("Top strip / Ticker")');
  await page.waitForURL(/\/admin\/ticker$/);
  await page.waitForLoadState("networkidle");
  await page.goto(BASE + "/");
  assert.ok(await page.$('.trend[data-mode="rotate"] .trend__rotor a'), "default strip rotates newest articles");
  const first = await page.textContent(".trend__rotor a");
  await page.waitForFunction((t) => document.querySelector(".trend__rotor a")?.textContent !== t, first, { timeout: 15000 });
  await page.goto(BASE + "/admin/ticker");
  await page.waitForLoadState("networkidle");
  await page.selectOption('label:has-text("What it shows") select', "custom");
  await page.click("text=Add text item");
  await page.fill('label:has-text("Text") input >> nth=0', "E2E ticker item");
  await page.check("text=Continuous scroll");
  await saveForm();
  await page.goto(BASE + "/");
  assert.ok((await page.textContent(".trend")).includes("E2E ticker item"));
  assert.ok(await page.$(".trend--scroll"));
  await page.click(".trend__pause");
  assert.ok(await page.$(".trend.is-paused"));
  await page.goto(BASE + "/admin/ticker");
  await page.waitForLoadState("networkidle");
  await page.selectOption('label:has-text("What it shows") select', "pinned"); // nothing picked -> falls back to newest
  await page.check("text=One at a time");
  await saveForm();
  await page.goto(BASE + "/");
  assert.ok(await page.$('.trend[data-mode="rotate"] .trend__rotor a'), "pinned with no picks still shows newest");
});
await check("homepage builder: add topic/text/CTA blocks, hide, reorder, layout, live preview", async () => {
  await page.goto(BASE + "/admin/homepage");
  await page.waitForLoadState("networkidle");
  const frame = page.frameLocator('iframe[title="Homepage preview"]');
  await frame.locator('[data-block="featured"]').waitFor();
  for (const type of ["category", "text", "cta"]) {
    await page.selectOption('[data-testid="home-add-type"]', type);
    await page.click('[data-testid="home-add"]');
  }
  const blocks = page.locator('[data-testid="home-blocks"] > .adm-block');
  const n = await blocks.count();
  await blocks.nth(n - 2).locator("textarea").fill("Hello from the **builder**.");
  await blocks.nth(n - 3).locator('input[placeholder]').first().fill("E2E topic block");
  // Pick a topic that actually has stories (the default first topic may be empty; empty blocks are hidden).
  await blocks.nth(n - 3).locator('label:has-text("Topic") select').selectOption("tech-news");
  await blocks.nth(n - 3).locator('label:has-text("Layout") select').selectOption("cards");
  await page.uncheck('[data-testid="home-blocks"] [data-block="also"] input[type="checkbox"]');
  await page.click('[aria-label="Move Topics grid up"]');
  await frame.locator("text=E2E topic block").waitFor({ timeout: 15000 }); // live, before saving
  await saveForm();
  await page.goto(BASE + "/");
  assert.equal(await page.$('[data-block="also"]'), null);
  assert.ok((await page.textContent("main")).includes("Hello from the builder."));
  assert.ok(await page.$('[data-block="category"] .card-grid--cards'));
  assert.ok(await page.$('[data-block="cta"] a.btn'));
  const order = await page.$$eval("main [data-block]", (els) => els.map((e) => e.getAttribute("data-block")));
  assert.ok(order.indexOf("topics") < order.indexOf("latest"), order.join(","));
  // restore
  await page.goto(BASE + "/admin/homepage");
  await page.waitForLoadState("networkidle");
  for (let i = 0; i < 3; i += 1) await page.locator('[data-testid="home-blocks"] > .adm-block').last().locator('button:has-text("Remove")').click();
  await page.check('[data-testid="home-blocks"] [data-block="also"] input[type="checkbox"]');
  await page.click('[aria-label="Move Topics grid down"]');
  await saveForm();
});
await check("automation: 200 topic ideas save (limit is 500, not 50)", async () => {
  await page.goto(BASE + "/admin/automation");
  await page.waitForLoadState("networkidle");
  const ideas = Array.from({ length: 200 }, (_, i) => `E2E topic idea ${i + 1}`).join("\n");
  await page.fill('label:has-text("Topic ideas") textarea', ideas);
  await page.click('button[type="submit"]:has-text("Save automation")');
  await page.waitForSelector('[role="status"]:has-text("saved"), [role="alert"]');
  await page.reload();
  await page.waitForLoadState("networkidle");
  assert.match(await page.textContent('[data-testid="topic-idea-count"]'), /200 \/ 500/);
});
await check("topic selection: sequence mode shows step and next topic", async () => {
  await page.goto(BASE + "/admin/automation");
  await page.waitForLoadState("networkidle");
  await page.selectOption('[data-testid="topic-mode"]', "sequence");
  assert.ok(await page.$('[data-testid="topic-step"]'));
  assert.match(await page.textContent('[data-testid="next-topic"]'), /Next topic in order/);
  await page.selectOption('[data-testid="topic-mode"]', "ai-choice");
  await page.click('button[type="submit"]:has-text("Save automation")');
  await page.waitForSelector('[role="status"]:has-text("saved"), [role="alert"]');
});
await check("admin dark mode: toggle persists and does not touch the public site", async () => {
  await page.goto(BASE + "/admin");
  await page.waitForLoadState("networkidle");
  const toggle = page.locator('[data-testid="admin-theme-toggle"]');
  await toggle.waitFor();
  // Icon-only binary toggle in the top-right: one click flips the mode.
  assert.equal((await toggle.innerText()).trim(), "");
  if ((await toggle.getAttribute("data-theme-value")) !== "dark") await toggle.click();
  const bg = await page.$eval(".desk", (e) => getComputedStyle(e).backgroundColor);
  assert.equal(bg, "rgb(17, 20, 24)");
  await page.reload();
  await page.waitForLoadState("networkidle");
  assert.equal(await page.$eval(".desk", (e) => e.getAttribute("data-theme")), "dark");
  await page.locator('[data-testid="admin-theme-toggle"]').click();
  assert.equal(await page.$eval(".desk", (e) => getComputedStyle(e).backgroundColor), "rgb(244, 246, 251)");
  // Sidebar: every nav option is its own boxed item, current page highlighted.
  await page.waitForTimeout(400); // let the 120ms hover/theme transition settle
  const activeBox = await page.$eval(".adm-nav__item.is-active", (e) => { const s = getComputedStyle(e); return { r: s.borderRadius, bg: s.backgroundColor }; });
  assert.notEqual(activeBox.r, "0px");
  assert.equal(activeBox.bg, "rgb(230, 69, 0)");
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
