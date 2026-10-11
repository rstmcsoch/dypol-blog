#!/usr/bin/env node
/**
 * Admin security E2E against a running `wrangler dev` (local D1/R2).
 *
 *   npm run build && npx wrangler d1 migrations apply DB --local
 *   echo 'ADMIN_TOKEN=<16+ chars>' > .dev.vars && npx wrangler dev --port 8787
 *   BASE=http://127.0.0.1:8787 ADMIN_TOKEN=<same> npm run test:e2e:security
 *   # locked mode (no ADMIN_TOKEN in .dev.vars):
 *   BASE=http://127.0.0.1:8787 EXPECT_LOCKED=1 npm run test:e2e:security
 *
 * Captures the real server-function requests an editor makes (upload, save
 * draft, settings), then replays them without a session and cross-site, and
 * checks they are refused and that nothing was written.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium, request as pwRequest } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const TOKEN = process.env.ADMIN_TOKEN ?? "";
const LOCKED = process.env.EXPECT_LOCKED === "1";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

function counts() {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", "--local", "--json", "--command",
      "select (select count(*) from articles) a, (select count(*) from media) m, (select data from site_settings where id='site') s"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return JSON.parse(out)[0].results[0];
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`not ok - ${name}\n  ${error instanceof Error ? error.message : error}`);
  }
}

function refused(status, body) {
  if (status >= 400) return true;
  return /Unauthorized|Forbidden|read-only/i.test(body);
}

const browser = await chromium.launch();
const anon = await pwRequest.newContext({ baseURL: BASE });

await check("/admin without a session redirects to /login", async () => {
  const r = await anon.get("/admin", { maxRedirects: 0 });
  assert.equal(r.status(), 307);
  assert.match(r.headers().location ?? "", /\/login\?denied=(true|false)/);
  if (LOCKED) assert.match(r.headers().location ?? "", /denied=true/);
});

for (const path of ["/admin/articles", "/admin/topics", "/admin/media", "/admin/settings", "/admin/articles/new"]) {
  await check(`${path} without a session never renders the desk`, async () => {
    const r = await anon.get(path, { maxRedirects: 0 });
    assert.ok([302, 307].includes(r.status()), `status ${r.status()}`);
  });
}

if (LOCKED) {
  await check("sign-in is refused when ADMIN_TOKEN is not configured", async () => {
    const page = await browser.newPage();
    await page.goto(BASE + "/login");
    await page.fill('input[type="password"]', "anything-anything-anything");
    await page.click('button[type="submit"]');
    await page.waitForSelector('[role="alert"]');
    assert.match(await page.textContent('[role="alert"]'), /locked/i);
    await page.goto(BASE + "/admin");
    assert.match(page.url(), /\/login/);
    await page.close();
  });
} else {
  assert.ok(TOKEN.length >= 16, "set ADMIN_TOKEN (16+ chars) to match .dev.vars");
  const context = await browser.newContext();
  const page = await context.newPage();
  const calls = [];
  page.on("request", (req) => {
    if (req.url().includes("/_serverFn/") && req.method() === "POST") {
      calls.push({ url: req.url(), headers: req.headers(), body: req.postDataBuffer() });
    }
  });

  await check("wrong token is rejected", async () => {
    await page.goto(BASE + "/login");
    await page.fill('input[type="password"]', "definitely-not-the-token");
    await page.click('button[type="submit"]');
    await page.waitForSelector('[role="alert"]');
    assert.match(await page.textContent('[role="alert"]'), /not right/i);
  });

  await page.fill('input[type="password"]', TOKEN);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin$/);

  const signInCalls = calls.slice();
  await check("desk cookie is HttpOnly, Secure, SameSite=Lax, short-lived, signed with iat/exp/nonce", async () => {
    const cookie = (await context.cookies()).find((c) => c.name === "dypol_desk");
    assert.ok(cookie, "cookie set");
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.secure, true);
    assert.equal(cookie.sameSite, "Lax");
    const now = Date.now() / 1000;
    assert.ok(cookie.expires > now + 11 * 3600 && cookie.expires < now + 13 * 3600, "~12 hour expiry");
    const [v, iat, exp, nonce, mac] = cookie.value.split(".");
    assert.equal(v, "v1");
    assert.equal(Number(exp) - Number(iat), 12 * 3600);
    assert.match(nonce, /^[0-9a-f]{32}$/);
    assert.match(mac, /^[0-9a-f]{64}$/);
  });

  // Real editor writes, captured for replay.
  const loginCalls = calls.length;
  await page.goto(BASE + "/admin/media");
  await page.setInputFiles('input[type="file"]', { name: "e2e.png", mimeType: "image/png", buffer: PNG });
  await page.click('form button[type="submit"]');
  await page.waitForSelector("text=Uploaded.");
  await page.goto(BASE + "/admin/articles/new");
  await page.getByLabel(/^Title/).first().fill("E2E security probe");
  await page.getByRole("button", { name: /^Save/ }).first().click();
  await page.waitForURL(/\/admin\/articles\/[0-9a-f-]{36}$/);
  const writes = calls.slice(loginCalls).filter((c) => c.body && c.body.length > 0);
  assert.ok(writes.length >= 2, `captured ${writes.length} write calls`);

  const before = counts();
  await check("replayed writes without a session are refused and write nothing", async () => {
    for (const call of writes) {
      const headers = { ...call.headers };
      delete headers.cookie;
      const r = await anon.post(call.url, { headers, data: call.body, maxRedirects: 0 });
      assert.ok(refused(r.status(), await r.text()), `${call.url} -> ${r.status()}`);
    }
    assert.deepEqual(counts(), before);
  });

  await check("a tampered session (extended expiry) is refused", async () => {
    const cookie = (await context.cookies()).find((c) => c.name === "dypol_desk");
    const [v, iat, , nonce, mac] = cookie.value.split(".");
    const forged = [v, iat, String(Number(iat) + 365 * 86400), nonce, mac].join(".");
    const r = await anon.get("/admin", { headers: { cookie: `dypol_desk=${forged}` }, maxRedirects: 0 });
    assert.equal(r.status(), 307);
    const ok = await anon.get("/admin", { headers: { cookie: `dypol_desk=${cookie.value}` }, maxRedirects: 0 });
    assert.equal(ok.status(), 200, "the genuine cookie still works");
  });

  await check("replayed writes with a forged cookie are refused", async () => {
    for (const call of writes) {
      const headers = { ...call.headers, cookie: "dypol_desk=" + "0".repeat(64) };
      const r = await anon.post(call.url, { headers, data: call.body });
      assert.ok(refused(r.status(), await r.text()), `${call.url} -> ${r.status()}`);
    }
    assert.deepEqual(counts(), before);
  });

  await check("cross-site writes with a valid session are refused (CSRF)", async () => {
    const cookieHeader = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
    for (const call of writes) {
      for (const extra of [{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }]) {
        const r = await anon.post(call.url, { headers: { ...call.headers, cookie: cookieHeader, ...extra }, data: call.body });
        assert.ok(refused(r.status(), await r.text()), `${call.url} ${JSON.stringify(extra)} -> ${r.status()}`);
      }
    }
    assert.deepEqual(counts(), before);
  });

  await check("sign-out clears the session", async () => {
    await page.goto(BASE + "/admin/settings");
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
    await page.goto(BASE + "/admin");
    assert.match(page.url(), /\/login/);
  });
  await context.close();

  // Last, because it leaves this IP throttled for up to a minute.
  await check("sign-in is rate limited per IP: 429 + Retry-After, same answer for right and wrong tokens", async () => {
    const wrong = signInCalls.find((c) => !c.body.toString().includes(TOKEN));
    const right = signInCalls.find((c) => c.body.toString().includes(TOKEN));
    assert.ok(wrong && right, "captured both sign-in requests");
    const statuses = [];
    for (let i = 0; i < 8; i += 1) {
      const r = await anon.post(wrong.url, { headers: { ...wrong.headers, cookie: "" }, data: wrong.body });
      statuses.push(r.status());
      if (r.status() === 429) {
        assert.equal(r.headers()["retry-after"], "60");
        assert.match(await r.text(), /limited/);
      }
    }
    assert.ok(statuses.includes(429), `statuses ${statuses.join(",")}`);
    assert.ok(statuses.filter((s) => s !== 429).length <= 5, `at most 5 attempts per minute: ${statuses.join(",")}`);
    const r = await anon.post(right.url, { headers: { ...right.headers, cookie: "" }, data: right.body });
    assert.equal(r.status(), 429, "the correct token is throttled too (no validity oracle)");
    assert.equal(r.headers()["set-cookie"], undefined, "no session issued while throttled");
    const ui = await browser.newPage();
    // Fixed windows can roll over mid-test, so use a wrong token until the UI shows the throttle.
    await ui.goto(BASE + "/login");
    let message = "";
    for (let i = 0; i < 7 && !/Too many/.test(message); i += 1) {
      await ui.fill('input[type="password"]', "still-the-wrong-token");
      await ui.click('button[type="submit"]');
      await ui.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
      message = (await ui.textContent('[role="alert"]').catch(() => "")) ?? "";
    }
    assert.match(message, /Too many attempts\. Try again in 60 seconds/);
    await ui.close();
  });
}

await anon.dispose();
await browser.close();
if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall admin security checks passed");
