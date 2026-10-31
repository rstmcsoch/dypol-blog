#!/usr/bin/env node
/**
 * t141 per-automation author names, end to end. WRITES to the target DB:
 * local dev or an isolated preview only, never production.
 *   BASE=http://127.0.0.1:8080 ADMIN_TOKEN=<token> node scripts/e2e/authors.e2e.mjs
 * Creates two profiles (one with the author set at creation, one set inline),
 * checks the duplicate-name inline error, submits one MCP draft per profile and
 * checks each byline, checks 390px layout in light + dark, then cleans up.
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:8080";
const TOKEN = process.env.ADMIN_TOKEN ?? "";
const SHOTS = process.env.SHOTS ?? "/tmp/t141-shots";
assert.ok(TOKEN.length >= 16, "set ADMIN_TOKEN");
if (/^(blog\.dypol|dypolblog\.rstmcsoch|dypol-blog\.rstmcsoch)\.workers\.dev$/.test(new URL(BASE).host)) throw new Error("Refusing production.");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); } catch (e) { failures++; console.log(`not ok - ${name}\n  ${e instanceof Error ? e.message.split("\n").slice(0, 4).join(" | ") : e}`); }
}
const letters = () => Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("");
const tag = letters();
const AUTHOR_A = `John Daniel ${tag[0].toUpperCase()}${tag.slice(1)}`;
const AUTHOR_B = `Michael Gose ${tag[0].toUpperCase()}${tag.slice(1)}`;
const NAME_A = `Authors A ${tag}`, NAME_B = `Authors B ${tag}`;

async function mcp(token, name, args = {}) {
  const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }) });
  const text = await r.text();
  let payload; try { payload = JSON.parse(text); } catch { payload = JSON.parse(text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "{}"); }
  const content = payload.result?.content?.[0]?.text;
  if (!content) return payload;
  const parsed = JSON.parse(content);
  return parsed && typeof parsed === "object" && "ok" in parsed ? parsed : { ok: !parsed.error, data: parsed, error: parsed.error };
}

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const context = await browser.newContext();
const page = await context.newPage();
page.on("dialog", (d) => d.accept());
await page.goto(BASE + "/login");
await page.waitForLoadState("networkidle");
await page.fill('input[type="password"]', TOKEN);
await page.click('button[type="submit"]');
await page.waitForURL(/\/admin\/?$/);
await page.waitForLoadState("networkidle");
await page.waitForTimeout(2500);

async function createProfile(name, author) {
  await page.goto(BASE + "/admin/automation");
  await page.waitForLoadState("networkidle");
  await page.fill('input[placeholder="Gemini daily tech"]', name);
  if (author) await page.fill('[data-testid="new-profile-author"]', author);
  await page.click('button:has-text("Add profile")');
  await page.waitForSelector('[data-testid="new-token"] code');
  const token = (await page.textContent('[data-testid="new-token"] code')).trim();
  await page.waitForURL(/profile=p[0-9a-f]{8}/);
  const id = new URL(page.url()).searchParams.get("profile");
  await page.click('button:has-text("I\'ve saved it")');
  // Enable the profile so it can submit drafts.
  await page.locator('label:has-text("Enabled") input[type="checkbox"]').first().check();
  await page.click('button[type="submit"]:has-text("Save automation")');
  await page.waitForTimeout(1200);
  return { id, token };
}

let A, B;
await check("create profile with author name in the create form", async () => {
  A = await createProfile(NAME_A, AUTHOR_A);
  assert.ok(A.token.startsWith("dyp_") && A.id);
  assert.equal(await page.inputValue(`[aria-label="Author name for ${NAME_A}"]`), AUTHOR_A);
});
await check("create profile without author, then duplicate name shows inline error", async () => {
  B = await createProfile(NAME_B, "");
  const input = page.locator(`[aria-label="Author name for ${NAME_B}"]`);
  await input.fill(AUTHOR_A.toLowerCase());
  const cell = page.locator(`[data-testid="author-${B.id}"]`);
  await cell.locator('[role="alert"]').waitFor();
  assert.match(await cell.locator('[role="alert"]').textContent(), /already uses/);
  assert.equal(await cell.locator("button").isDisabled(), true);
  await input.fill("<b>Bad</b>");
  assert.match(await cell.locator('[role="alert"]').textContent(), /HTML/);
});
await check("set author inline on the second profile", async () => {
  const cell = page.locator(`[data-testid="author-${B.id}"]`);
  await page.fill(`[aria-label="Author name for ${NAME_B}"]`, AUTHOR_B);
  await cell.locator("button").click();
  await cell.locator('[role="status"]:has-text("Saved")').waitFor();
  await page.reload(); await page.waitForLoadState("networkidle");
  assert.equal(await page.inputValue(`[aria-label="Author name for ${NAME_B}"]`), AUTHOR_B);
});

const words = (n, s) => Array.from({ length: n }, (_, i) => `${s}${i % 13}word`).join(" ");
let artA, artB, slugA, slugB;
await check("each profile's MCP create stores its own author", async () => {
  const settings = await mcp(A.token, "get_blog_settings");
  const topic = settings.data?.topics?.[0]?.slug ?? settings.data?.categories?.[0]?.slug ?? settings.data?.automation?.topics?.[0]?.slug;
  assert.ok(topic, "no topic: " + JSON.stringify(settings).slice(0, 300));
  const art = (k) => ({ idempotency_key: `authors-${tag}-${k}`, title: `${letters()}${letters()} ${letters()}${letters()} ${letters()}${letters()} ${letters()} ${k}`, excerpt: "Submitted by the author-name e2e test to verify bylines.", body: `## Why\n\n${words(90, "alpha" + k)}\n\n${words(70, "beta" + k)}`, topics: [topic], tags: [], source_urls: [`https://en.wikipedia.org/wiki/Byline_${tag}_${k}`, `https://developers.cloudflare.com/d1/${tag}-${k}/`] });
  const [ra, rb] = await Promise.all([mcp(A.token, "submit_article_draft", art("a")), mcp(B.token, "submit_article_draft", art("b"))]);
  assert.equal(ra.ok, true, JSON.stringify(ra).slice(0, 300)); assert.equal(rb.ok, true, JSON.stringify(rb).slice(0, 300));
  assert.equal(ra.data.author, AUTHOR_A); assert.equal(rb.data.author, AUTHOR_B);
  artA = ra.data.article_id; artB = rb.data.article_id; slugA = ra.data.slug; slugB = rb.data.slug;
});
await check("bylines render per article (preview)", async () => {
  for (const [id, who] of [[artA, AUTHOR_A], [artB, AUTHOR_B]]) {
    await page.goto(`${BASE}/preview/${id}`); await page.waitForLoadState("networkidle");
    assert.equal((await page.textContent(".byline"))?.trim(), `by ${who}`);
  }
});
await check("updating keeps the author; another profile can't restamp it", async () => {
  await page.goto(BASE + "/admin/automation"); await page.waitForLoadState("networkidle");
  // Rename A's author; existing article must keep the old name.
  const cell = page.locator(`[data-testid="author-${A.id}"]`);
  await page.fill(`[aria-label="Author name for ${NAME_A}"]`, `Changed Name ${tag}`);
  await cell.locator("button").click(); await cell.locator('[role="status"]').waitFor();
  const up = await mcp(A.token, "update_article_draft", { article_id: artA, excerpt: "Updated excerpt from the author-name e2e test." });
  assert.equal(up.ok, true, JSON.stringify(up).slice(0, 300));
  await page.goto(`${BASE}/preview/${artA}`); await page.waitForLoadState("networkidle");
  assert.equal((await page.textContent(".byline"))?.trim(), `by ${AUTHOR_A}`);
});

await check("390px layout: author field doesn't overlap, light + dark", async () => {
  const state = await context.storageState();
  for (const theme of ["light", "dark"]) {
    // Admin theme defaults to "system", so the OS color scheme drives it.
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: state, colorScheme: theme });
    const p = await m.newPage();
    await p.goto(BASE + "/admin/automation"); await p.waitForLoadState("networkidle");
    const cell = p.locator(`[data-testid="author-${B.id}"]`);
    await cell.scrollIntoViewIfNeeded();
    const ib = await cell.locator("input").boundingBox(), bb = await cell.locator("button").boundingBox();
    assert.ok(ib && bb && ib.width >= 80, "input too narrow");
    const overlap = !(ib.x + ib.width <= bb.x + 0.5 || bb.x + bb.width <= ib.x + 0.5 || ib.y + ib.height <= bb.y + 0.5 || bb.y + bb.height <= ib.y + 0.5);
    assert.equal(overlap, false, "input overlaps Save");
    const form = p.locator('[data-testid="new-profile-author"]');
    const fb = await form.boundingBox(); assert.ok(fb && fb.x >= 0 && fb.x + fb.width <= 390 + 1, "create-form author field off-screen");
    await cell.screenshot({ path: `${SHOTS}/author-cell-390-${theme}.png` });
    await form.scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${SHOTS}/author-form-390-${theme}.png` });
    await m.close();
  }
});

// Cleanup: drafts, then profiles.
for (const [t, id, slug] of [[A?.token, artA, slugA], [B?.token, artB, slugB]]) {
  if (!t || !id) continue;
  const del = await mcp(t, "delete_article_draft", { article_id: id, confirm: true, slug }).catch((e) => ({ ok: false, error: String(e) }));
  console.log(`cleanup draft ${id}: ${del.ok ? "deleted" : JSON.stringify(del).slice(0, 200)}`);
}
await page.goto(BASE + "/admin/automation"); await page.waitForLoadState("networkidle");
for (const name of [NAME_A, NAME_B]) {
  const row = page.locator("tr", { hasText: name });
  if (await row.count()) { await row.locator('button:has-text("Delete")').click(); await page.waitForTimeout(800); }
}
await browser.close();
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
