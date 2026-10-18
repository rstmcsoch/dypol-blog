#!/usr/bin/env node
/**
 * "Delete old articles" admin e2e. Seeds dated articles directly into the
 * LOCAL D1, drives the admin panel with Playwright, and verifies only the
 * matching articles are deleted. Expected counts are computed from whatever
 * already lives in the local database (this suite is not the first to use
 * it), and any pre-existing articles the bulk delete removes are restored
 * from a backup at the end. Local only — refuses production hosts.
 *   BASE=http://127.0.0.1:8787 ADMIN_TOKEN=<token> npm run test:e2e:cleanup
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const TOKEN = process.env.ADMIN_TOKEN ?? "";
assert.ok(TOKEN.length >= 16, "set ADMIN_TOKEN");
const host = new URL(BASE).host;
if (/dypolblog\.rstmcsoch\.workers\.dev$/.test(host) && !host.includes("-dypolblog")) {
  throw new Error("Refusing to run write tests against production.");
}
assert.ok(/^(127\.0\.0\.1|localhost)/.test(host), "local only");

function sql(command) {
  return execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--command", command, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function query(command) {
  return JSON.parse(sql(command))[0].results;
}
function queryIds() {
  return query("SELECT id FROM articles WHERE id LIKE 'e2e-%' ORDER BY id").map((r) => r.id);
}
const esc = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replaceAll("'", "''")}'`);

const now = Date.now();
const iso = (days) => new Date(now - days * 86400000).toISOString();
const old = iso(60), recent = iso(1);

// Back up every pre-existing article (+ tag links) so the bulk delete's local
// collateral can be restored afterwards.
const backupArticles = query("SELECT * FROM articles");
const backupTags = query("SELECT * FROM article_tags");

sql(`INSERT OR IGNORE INTO categories (id, slug, label, description) VALUES ('e2e-cat', 'e2e', 'E2E', '');
DELETE FROM articles WHERE id LIKE 'e2e-%';
INSERT INTO articles (id, slug, title, excerpt, status, published_at, updated_at, category_id, motif, featured, blocks) VALUES
 ('e2e-old-draft', 'e2e-old-draft', 'E2E Old Draft', '', 'draft', NULL, '${old}', 'e2e-cat', 'corner', 0, '[]'),
 ('e2e-old-unpub', 'e2e-old-unpub', 'E2E Old Unpublished', '', 'unpublished', '${old}', '${old}', 'e2e-cat', 'band', 0, '[]'),
 ('e2e-old-pub', 'e2e-old-pub', 'E2E Old Published', '', 'published', '${old}', '${recent}', 'e2e-cat', 'split', 0, '[]'),
 ('e2e-recent-draft', 'e2e-recent-draft', 'E2E Recent Draft', '', 'draft', NULL, '${recent}', 'e2e-cat', 'stamp', 0, '[]');`);
assert.deepEqual(queryIds(), ["e2e-old-draft", "e2e-old-pub", "e2e-old-unpub", "e2e-recent-draft"], "seed failed");

// Mirror of the panel's matching rule (1-month preset), computed live so the
// suite passes on a shared local database.
const SCOPE_STATUSES = {
  "drafts-unpublished": ["draft", "unpublished"],
  drafts: ["draft"],
  unpublished: ["unpublished"],
  published: ["published"],
  all: ["draft", "unpublished", "published"],
};
function expectedCount(scope) {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return query("SELECT status, published_at, updated_at FROM articles").filter((a) => {
    if (!SCOPE_STATUSES[scope].includes(a.status)) return false;
    const basis = a.status === "published" ? a.published_at : a.updated_at;
    return basis !== null && new Date(basis) < d;
  }).length;
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); }
  catch (error) { failures += 1; console.log(`not ok - ${name}\n  ${error instanceof Error ? error.message.split("\n")[0] : error}`); }
}

const browser = await chromium.launch();
try {
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(BASE + "/admin/articles");
  await check("logged-out /admin/articles redirects to /login", async () => {
    await anonPage.waitForURL(/\/login/, { timeout: 10000 });
  });
  await anon.close();

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE + "/login");
  await page.waitForLoadState("networkidle");
  await page.fill('input[type="password"]', TOKEN);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\/?$/, { waitUntil: "commit" });
  await page.goto(BASE + "/admin/articles");
  await page.waitForLoadState("networkidle");

  const panel = () => page.textContent('section[aria-labelledby="old-articles-head"]');
  const scopeSelect = page.locator('section[aria-labelledby="old-articles-head"] select').nth(1);
  const waitCount = (n) =>
    page.waitForFunction(
      (expected) => new RegExp(`\\b${expected} articles? dated before`).test(document.querySelector('[data-testid="old-preview-count"]')?.textContent ?? ""),
      n,
      { timeout: 10000 }
    );

  await check("panel present with plain date-basis explanation", async () => {
    const text = await panel();
    assert.ok(text.includes("Delete old articles"), "heading");
    assert.ok(text.includes("publish date") && text.includes("last-saved date"), "basis note");
    assert.ok(text.includes("Cover image files stay in Media"), "cover note");
  });

  await check("default preview (drafts+unpublished, 1 month) matches DB truth, excludes published + recent", async () => {
    const n = expectedCount("drafts-unpublished");
    assert.ok(n >= 2, "seed contributes at least 2");
    await waitCount(n);
    const text = await panel();
    assert.ok(text.includes("E2E Old Draft") && text.includes("E2E Old Unpublished"), "rows");
    // The articles table above the panel also lists these titles; only check the panel rows region.
    const rows = await page.locator('section[aria-labelledby="old-articles-head"] .desk-table').textContent();
    assert.ok(!rows.includes("E2E Old Published"), "published excluded by default scope");
    assert.ok(!rows.includes("E2E Recent Draft"), "recent excluded");
  });

  await check("scope=published preview matches only old published (by publish date, despite recent edit)", async () => {
    const n = expectedCount("published");
    assert.ok(n >= 1, "seed contributes at least 1");
    await scopeSelect.selectOption("published");
    await waitCount(n);
    const text = await panel();
    const rows = await page.locator('section[aria-labelledby="old-articles-head"] .desk-table').textContent();
    assert.ok(rows.includes("E2E Old Published"), "row");
    assert.ok(!rows.includes("E2E Old Draft"), "drafts excluded");
    assert.ok(text.includes("published articles"), "warning shown");
  });

  await check("scope=all preview count matches DB truth", async () => {
    await scopeSelect.selectOption("all");
    await waitCount(expectedCount("all"));
  });

  await check("delete drafts+unpublished: dialog gates on checkbox, deletes exactly the matches", async () => {
    await scopeSelect.selectOption("drafts-unpublished");
    const n = expectedCount("drafts-unpublished");
    await waitCount(n);
    await page.click(`button:has-text("Delete ${n} old article")`);
    const dialog = page.locator("dialog.adm-dialog[open]");
    await dialog.waitFor({ state: "visible" });
    const confirmBtn = dialog.locator(`button:has-text("Delete ${n} permanently")`);
    assert.ok(await confirmBtn.isDisabled(), "disabled before checkbox");
    await dialog.locator('input[type="checkbox"]').check();
    assert.ok(await confirmBtn.isEnabled(), "enabled after checkbox");
    await confirmBtn.click();
    await page.waitForSelector(`[role="status"]:has-text("Deleted ${n} article")`, { timeout: 15000 });
    assert.deepEqual(queryIds(), ["e2e-old-pub", "e2e-recent-draft"], "seeded survivors");
    assert.equal(expectedCount("drafts-unpublished"), 0, "no matches remain");
  });

  await check("preview now matches 0 for drafts+unpublished", async () => {
    await page.waitForFunction(
      () => document.querySelector('[data-testid="old-preview-count"]')?.textContent?.includes("Nothing matches"),
      null,
      { timeout: 10000 }
    );
  });

  await check("delete published scope removes it and its public URL 404s", async () => {
    const before = await context.request.get(BASE + "/articles/e2e-old-pub");
    assert.equal(before.status(), 200, "published URL live before delete");
    await scopeSelect.selectOption("published");
    const n = expectedCount("published");
    assert.ok(n >= 1);
    await waitCount(n);
    await page.click(`button:has-text("Delete ${n} old article")`);
    const dialog = page.locator("dialog.adm-dialog[open]");
    await dialog.waitFor({ state: "visible" });
    await dialog.locator('input[type="checkbox"]').check();
    await dialog.locator(`button:has-text("Delete ${n} permanently")`).click();
    await page.waitForSelector(`[role="status"]:has-text("Deleted ${n} article")`, { timeout: 15000 });
    assert.deepEqual(queryIds(), ["e2e-recent-draft"], "only recent draft remains");
    const after = await context.request.get(BASE + "/articles/e2e-old-pub");
    assert.equal(after.status(), 404, "deleted published URL 404s");
  });
} finally {
  try {
    sql("DELETE FROM articles WHERE id LIKE 'e2e-%'; DELETE FROM categories WHERE id = 'e2e-cat';");
    // Restore any pre-existing articles (and tag links) the bulk delete removed.
    for (const row of backupArticles) {
      const cols = Object.keys(row);
      sql(`INSERT OR IGNORE INTO articles (${cols.join(", ")}) VALUES (${cols.map((c) => esc(row[c])).join(", ")});`);
    }
    for (const row of backupTags) {
      sql(`INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (${esc(row.article_id)}, ${esc(row.tag_id)});`);
    }
  } catch { /* best-effort restore */ }
  await browser.close();
}
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
