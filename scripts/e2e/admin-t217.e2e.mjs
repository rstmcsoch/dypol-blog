#!/usr/bin/env node
/**
 * t217 admin Settings tabs + Homepage builder memory-only preview (real Chromium).
 * WRITES (one Save, then restores) — run only against local `wrangler dev` or an isolated preview.
 *   BASE=http://127.0.0.1:8787 ADMIN_TOKEN=<token> node scripts/e2e/admin-t217.e2e.mjs
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const TOKEN = process.env.ADMIN_TOKEN ?? "";
assert.ok(TOKEN.length >= 16, "set ADMIN_TOKEN");
assert.ok(/^(127\.0\.0\.1|localhost):/.test(new URL(BASE).host), "local only");
const fingerprint = () =>
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--json", "--command", "select (select group_concat(id||':'||length(data)||':'||data, '|') from site_settings) s, (select v from content_version where id=1) v, (select count(*) from articles) a"], { encoding: "utf8" });

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`ok - ${name}`); } catch (e) { failures++; console.log(`not ok - ${name}\n  ${String(e?.message ?? e).split("\n")[0]}`); }
};

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const posts = [];
page.on("request", (r) => r.method() === "POST" && r.url().includes("/_serverFn/") && posts.push({ url: r.url(), body: r.postData() ?? "", frame: r.frame() === page.mainFrame() ? "main" : "frame" }));
await page.goto(BASE + "/login");
await page.fill('input[type="password"]', TOKEN);
await page.click('button[type="submit"]');
await page.waitForURL(/\/admin\/?$/);
await page.waitForLoadState("networkidle");

// ---------- Settings tabs ----------
await page.goto(BASE + "/admin/settings");
await page.waitForSelector('[role="tablist"]');
const original = { name: await page.inputValue('label:has-text("Website name") input') };

await check("settings: 6 tabs under the heading, sidebar unchanged", async () => {
  const tabs = await page.$$eval('[role="tab"]', (els) => els.map((e) => e.textContent));
  assert.deepEqual(tabs, ["General", "Social links", "Sharing", "Analytics & head code", "AI publishing", "Access"]);
  const order = await page.evaluate(() => {
    const h = document.querySelector(".desk-title"), t = document.querySelector('[role="tablist"]');
    return !!(h.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) && !!document.querySelector(".adm-nav") && !t.closest(".adm-nav");
  });
  assert.ok(order);
  assert.equal(await page.$$eval('[role="tabpanel"]:not([hidden])', (e) => e.length), 1);
});

await check("settings: keyboard arrows/Home/End move selection and focus", async () => {
  await page.focus('[role="tab"][aria-selected="true"]');
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getAttribute('[role="tab"][aria-selected="true"]', "id"), "settings-tab-social");
  await page.keyboard.press("End");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "settings-tab-access");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Home");
  assert.equal(await page.getAttribute('[role="tab"][aria-selected="true"]', "id"), "settings-tab-general");
});

await check("settings: unsaved values survive tab switches; hidden-tab required field opens its tab and blocks save", async () => {
  await page.fill('label:has-text("Website name") input', "");
  await page.click("#settings-tab-sharing");
  await page.click('#settings-tab-social');
  await page.click("#settings-tab-sharing");
  const before = posts.length;
  await page.click('button[type="submit"]:has-text("Save changes")');
  await page.waitForTimeout(400);
  assert.equal(await page.getAttribute('[role="tab"][aria-selected="true"]', "id"), "settings-tab-general");
  assert.equal(posts.length, before, "no save request while invalid");
  assert.equal(await page.inputValue('label:has-text("Website name") input'), "");
});

await check("settings: Save sends the full record (all tabs) and stores values from a hidden tab", async () => {
  await page.fill('label:has-text("Website name") input', original.name + " QA");
  await page.click("#settings-tab-publishing");
  const before = posts.length;
  await page.click('button[type="submit"]:has-text("Save changes")');
  await page.waitForSelector('[role="status"]:has-text("Saved"), [role="alert"]');
  const body = posts.slice(before).map((p) => p.body).join("");
  for (const k of ["socials", "share", "customHead", "analytics", "aiDailyPublishLimit", "logoMediaId", "home", "articleSidebar"]) assert.ok(body.includes(k), k);
  assert.ok(body.includes(original.name + " QA"));
  await page.reload();
  assert.equal(await page.inputValue('label:has-text("Website name") input'), original.name + " QA");
  await page.fill('label:has-text("Website name") input', original.name);
  await page.click('button[type="submit"]:has-text("Save changes")');
  await page.waitForSelector('[role="status"]:has-text("Saved")');
});

await check("settings: narrow (820px/390px) tab strip scrolls sideways; every tab reachable", async () => {
  for (const w of [820, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    const m = await page.$eval('[role="tablist"]', (t) => ({ ov: getComputedStyle(t).overflowX, sw: t.scrollWidth, cw: t.clientWidth, docW: document.documentElement.scrollWidth }));
    assert.equal(m.ov, "auto");
    assert.ok(m.docW <= w + 1, `page overflow at ${w}: ${m.docW}`);
    await page.click("#settings-tab-access");
    assert.ok(await page.isVisible("#settings-panel-access"));
  }
  await page.setViewportSize({ width: 1280, height: 900 });
});

// ---------- Homepage builder ----------
const heading = 'fieldset:has(legend:text-is("Homepage blocks")) input[maxlength="120"]';
const DRAFT = "QA DRAFT " + Date.now();
await page.goto(BASE + "/admin/homepage");
await page.waitForSelector(heading);
const stored = await page.inputValue(heading);

await check("homepage: no mini preview frame; editor full width; Preview button in title area", async () => {
  assert.equal(await page.$$eval("iframe", (e) => e.length), 0);
  assert.ok(await page.isVisible('.adm-titlebar button:has-text("Preview")'));
  const w = await page.$eval(".adm-builder", (el) => [el.getBoundingClientRect().width, el.parentElement.getBoundingClientRect().width]);
  assert.ok(w[0] >= w[1] - 2, String(w));
});

await check("homepage: Preview shows the unsaved draft via the real renderer; no DB write or version bump", async () => {
  const fp = fingerprint();
  await page.fill(heading, DRAFT);
  const before = posts.length;
  await page.click('.adm-titlebar button:has-text("Preview")');
  await page.waitForSelector("dialog.adm-previewdlg[open] iframe");
  const frame = page.frameLocator("dialog.adm-previewdlg iframe");
  await frame.locator(`text=${DRAFT}`).first().waitFor({ timeout: 10000 });
  for (const p of posts.slice(before)) assert.doesNotMatch(p.body, /customHead|socials/, "only preview payload sent");
  assert.equal(fingerprint(), fp, "database unchanged");
  const pub = await (await context.request.get(BASE + "/")).text();
  assert.ok(!pub.includes(DRAFT), "public page unaffected");
  for (const w of ["Tablet", "Phone"]) {
    await page.click(`.adm-previewdlg__sizes button:has-text("${w}")`);
    await frame.locator(`text=${DRAFT}`).first().waitFor();
  }
  assert.equal(await page.$eval("html", (h) => h.getAttribute("data-event") ?? ""), "", "no public event attrs leaked into admin");
});

await check("homepage: Esc closes; draft remains while staying on the builder", async () => {
  await page.keyboard.press("Escape");
  await page.waitForSelector("dialog.adm-previewdlg:not([open])", { state: "attached" });
  assert.equal(await page.$$eval("iframe", (e) => e.length), 0, "frame unmounted");
  assert.equal(await page.inputValue(heading), DRAFT);
});

await check("homepage: draft is not in any browser storage or the URL", async () => {
  const leak = await page.evaluate((d) => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, c: document.cookie, u: location.href }).includes(d), DRAFT);
  assert.equal(leak, false);
});

await check("homepage: leaving to another admin page then Back discards the draft", async () => {
  await page.click('.adm-nav a[href="/admin/settings"]');
  await page.waitForSelector('[role="tablist"]');
  await page.goBack();
  await page.waitForSelector(heading);
  assert.equal(await page.inputValue(heading), stored);
});

await check("homepage: reload discards the draft", async () => {
  await page.fill(heading, DRAFT);
  await page.reload();
  await page.waitForSelector(heading);
  assert.equal(await page.inputValue(heading), stored);
});

await check("homepage: leaving to a public page (full document) then Back discards the draft", async () => {
  await page.fill(heading, DRAFT);
  await page.goto(BASE + "/about");
  await page.goBack();
  await page.waitForSelector(heading);
  await page.waitForTimeout(500);
  assert.equal(await page.inputValue(heading), stored);
});

await check("homepage: only Save publishes; then restored", async () => {
  await page.fill(heading, DRAFT);
  await page.click('button[type="submit"]:has-text("Save changes")');
  await page.waitForSelector('[role="status"]:has-text("Saved")');
  const pub = await (await context.request.get(BASE + "/?cb=" + Date.now())).text();
  assert.ok(pub.includes(DRAFT), "saved draft visible publicly");
  await page.fill(heading, stored);
  await page.click('button[type="submit"]:has-text("Save changes")');
  await page.waitForSelector('[role="status"]:has-text("Saved")');
});

await browser.close();
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
