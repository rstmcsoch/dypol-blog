#!/usr/bin/env node
/**
 * Username + password + TOTP admin login E2E (t80) against local wrangler dev.
 *
 *   npm run build && npx wrangler d1 migrations apply DB --local
 *   printf 'ADMIN_TOKEN=<16+>\nADMIN_SESSION_SECRET=<any>\nMCP_TOKEN=<16+>\n' > .dev.vars
 *   npx wrangler dev --port 8803
 *   BASE=http://127.0.0.1:8803 ADMIN_TOKEN=<same> node scripts/e2e/admin-password-login.e2e.mjs
 *
 * Each scenario uses its own cf-connecting-ip so the real 5/min sign-in
 * limiter stays honest instead of being waited out. Screenshots land in
 * SHOTS (default /workspace/t80-shots).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:8803";
const TOKEN = process.env.ADMIN_TOKEN ?? "";
const SHOTS = process.env.SHOTS ?? "/workspace/t80-shots";
mkdirSync(SHOTS, { recursive: true });
assert.ok(TOKEN.length >= 16, "set ADMIN_TOKEN (16+ chars) to match .dev.vars");

execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--json", "--command",
  "create table if not exists admin_users (id integer primary key autoincrement, username text not null unique, password_hash text not null, totp_secret_enc text, totp_pending_enc text, totp_enabled integer not null default 0, created_at integer not null, updated_at integer not null); create table if not exists admin_recovery_codes (id integer primary key autoincrement, user_id integer not null, code_hash text not null, used_at integer, created_at integer not null); delete from admin_recovery_codes; delete from admin_users;"],
  { stdio: ["ignore", "pipe", "ignore"] });

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(text) {
  let bits = 0, value = 0; const out = [];
  for (const ch of text.toUpperCase().replace(/[\s=-]/g, "")) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secretB32, at = Math.floor(Date.now() / 1000)) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30)));
  const mac = createHmac("sha1", base32Decode(secretB32)).update(counter).digest();
  const o = mac[mac.length - 1] & 0x0f;
  return String(mac.readUInt32BE(o) & 0x7fffffff).padStart(10, "0").slice(-6).padStart(6, "0");
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); }
  catch (e) { failures += 1; console.log(`not ok - ${name}\n  ${e instanceof Error ? e.message : e}`); }
}

const browser = await chromium.launch();
let ipSuffix = 10;
async function freshPage() {
  ipSuffix += 1;
  const context = await browser.newContext({ extraHTTPHeaders: { "cf-connecting-ip": `10.80.0.${ipSuffix}` } });
  return { context, page: await context.newPage() };
}
const USERNAME = "rustam";
const PASSWORD = "t80-e2e-password-1";
let secret = "";
let recoveryCodes = [];

await check("single entry: GET /login 308-redirects to /admin, sign-in renders inline at /admin (token state)", async () => {
  const { context, page } = await freshPage();
  const resp = await context.request.get(BASE + "/login", { maxRedirects: 0 });
  assert.equal(resp.status(), 308, `expected 308, got ${resp.status()}`);
  assert.match(resp.headers()["location"] ?? "", /\/admin/, "Location must point at /admin");
  await page.goto(BASE + "/admin");
  assert.match(page.url(), /\/admin$/, "no redirect away from /admin");
  await page.waitForSelector('text=Admin token');
  await page.screenshot({ path: `${SHOTS}/admin-signin-token.png` });
  // following the old bookmark lands on the same inline form, no loop
  await page.goto(BASE + "/login");
  await page.waitForSelector('text=Admin token');
  assert.match(page.url(), /\/admin/, "old /login bookmark ends at /admin");
  await context.close();
});

let capturedTokenLogin = null;
await check("before setup: token login works and Security page offers setup", async () => {
  const { context, page } = await freshPage();
  // Remember the exact token sign-in request so a later check can replay it
  // after 2FA activation and prove the SERVER refuses the token (t83/g).
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("_serverFn") && (req.postData() ?? "").includes(TOKEN)) {
      capturedTokenLogin = { url: req.url(), body: req.postData(), headers: req.headers() };
    }
  });
  await page.goto(BASE + "/admin");
  await page.waitForSelector('text=Admin token');
  await page.screenshot({ path: `${SHOTS}/login-token-before-setup.png` });
  await page.fill('input[type="password"]', TOKEN);
  await page.click('button[type="submit"]');
  await page.waitForSelector('button:has-text("Sign out")');
  await page.goto(BASE + "/admin/security");
  await page.waitForSelector("text=Set up password + 2FA sign-in");
  await page.screenshot({ path: `${SHOTS}/security-setup.png` });
  // complete the setup in the same signed-in session
  await page.fill('input[autocomplete="username"]', USERNAME);
  const pw = page.locator('input[autocomplete="new-password"]');
  await pw.nth(0).fill(PASSWORD);
  await pw.nth(1).fill(PASSWORD);
  await page.click('button:has-text("Create credentials")');
  await page.waitForSelector("text=Scan with your authenticator app");
  const body = await page.textContent("body");
  secret = ((body.match(/[A-Z2-7]{4}(?: [A-Z2-7]{4}){7}/) ?? [])[0] ?? "").replace(/ /g, "");
  assert.ok(secret.length === 32, "manual-entry secret shown");
  await page.screenshot({ path: `${SHOTS}/security-enrol-qr.png` });
  // t83: half-finished setup (credentials saved, authenticator NOT confirmed)
  // must be explicit at the root login: token form stays (lockout-safe
  // bootstrap) but the page says password sign-in is not active yet, instead
  // of silently looking as if password login was never implemented.
  {
    const pending = await freshPage();
    const redir = await pending.context.request.get(BASE + "/login", { maxRedirects: 0 });
    assert.equal(redir.status(), 308, "pending state: /login still 308s to /admin");
    await pending.page.goto(BASE + "/admin");
    await pending.page.waitForSelector('text=Admin token');
    await pending.page.waitForSelector("text=Password sign-in is not active yet");
    assert.equal(await pending.page.locator('input[autocomplete="username"]').count(), 0, "no password form before confirm");
    await pending.page.screenshot({ path: `${SHOTS}/login-token-pending-setup.png` });
    await pending.context.close();
  }
  // t82: reloading mid-enrolment (the exact prod state: credentials saved,
  // authenticator pending) must offer the finish-setup path, not a dead end.
  await page.reload();
  await page.waitForSelector("text=Setup is half-finished");
  await page.click('button:has-text("Show a fresh QR code")');
  await page.waitForSelector("text=Scan with your authenticator app");
  const bodyR = await page.textContent("body");
  secret = ((bodyR.match(/[A-Z2-7]{4}(?: [A-Z2-7]{4}){7}/) ?? [])[0] ?? "").replace(/ /g, "");
  assert.ok(secret.length === 32, "fresh secret after reload");
  // t82: a wrong code must produce a VISIBLE inline error, not silence,
  // and the enrolment must stay put so the user can retry.
  const wrongCode = totp(secret) === "000000" ? "111111" : "000000";
  await page.fill('input[autocomplete="one-time-code"]', wrongCode);
  await page.click('button:has-text("Confirm code")');
  await page.waitForSelector('section:has-text("Scan with your authenticator app") [role="alert"]');
  assert.match(await page.textContent('section:has-text("Scan with your authenticator app") [role="alert"]'), /did not match/);
  await page.screenshot({ path: `${SHOTS}/security-confirm-wrong-code.png` });
  // t82: "fresh QR" rotates the pending secret — the old secret's code is
  // then rejected, the new one confirms (also burns any shared secret).
  await page.click('button:has-text("Show a fresh QR code")');
  await page.waitForFunction((old) => {
    const m = document.body.innerText.match(/[A-Z2-7]{4}(?: [A-Z2-7]{4}){7}/);
    return m && m[0].replace(/ /g, "") !== old;
  }, secret);
  const body2 = await page.textContent("body");
  const secret2 = ((body2.match(/[A-Z2-7]{4}(?: [A-Z2-7]{4}){7}/) ?? [])[0] ?? "").replace(/ /g, "");
  assert.ok(secret2 && secret2 !== secret, "fresh QR produced a new secret");
  await page.fill('input[autocomplete="one-time-code"]', totp(secret));
  await page.click('button:has-text("Confirm code")');
  await page.waitForSelector('section:has-text("Scan with your authenticator app") [role="alert"]');
  secret = secret2;
  await page.fill('input[autocomplete="one-time-code"]', totp(secret));
  await page.click('button:has-text("Confirm code")');
  await page.waitForSelector("text=Save these recovery codes now");
  await page.waitForSelector("text=Password + 2FA sign-in is now active");
  assert.ok(await page.locator('button:has-text("Copy all codes")').count(), "copy button for recovery codes");
  const banner = await page.textContent("body");
  recoveryCodes = banner.match(/[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/g) ?? [];
  assert.equal(recoveryCodes.length, 10, `10 recovery codes shown, got ${recoveryCodes.length}`);
  await page.waitForSelector("text=Username + password + authenticator (2FA) is active");
  await page.screenshot({ path: `${SHOTS}/security-active.png` });
  // sign out (revokes this session server-side, SEC-005 behaviour preserved)
  await page.click('button:has-text("Sign out")');
  await page.waitForURL("**/admin");
  await page.waitForSelector('text=Sign in');
  await context.close();
});

await check("after setup: token sign-in is refused at the server, not just hidden", async () => {
  // The form disappearing is not the security boundary: signInDesk checks
  // the same credential state server-side (tokenSignInAllowed). Drive the
  // real server function the token form used, from a fresh browser context
  // with the correct token, and assert no desk session is issued.
  const { context, page } = await freshPage();
  await page.goto(BASE + "/admin");
  await page.waitForSelector('input[autocomplete="username"]');
  // Single-entry behaviour: /admin itself answers 200 with the inline
  // sign-in form (never a redirect to a separate login page, never the panel).
  const resp = await context.request.get(BASE + "/admin", { maxRedirects: 0 });
  assert.equal(resp.status(), 200, "unauthenticated /admin renders sign-in inline with 200");
  assert.match(await resp.text(), /Sign in/, "sign-in form is rendered at /admin");
  assert.ok(capturedTokenLogin, "token sign-in request was captured before setup");
  const replay = await context.request.post(capturedTokenLogin.url, {
    data: capturedTokenLogin.body,
    headers: { "content-type": capturedTokenLogin.headers["content-type"] ?? "application/json" },
  });
  const replayText = await replay.text();
  assert.ok(!/"ok"\s*:\s*true/.test(replayText), `token must not create a session after 2FA activation: ${replayText.slice(0, 200)}`);
  const cookies = await context.cookies(BASE);
  assert.ok(!cookies.some((c) => c.name === "dypol_desk"), "no desk session cookie issued for the token");
  await context.close();
});

await check("after setup: /admin asks username+password, no token field", async () => {
  const { context, page } = await freshPage();
  const redir = await context.request.get(BASE + "/login", { maxRedirects: 0 });
  assert.equal(redir.status(), 308, "active state: /login 308s to /admin");
  await page.goto(BASE + "/admin");
  await page.waitForSelector('input[autocomplete="username"]');
  assert.equal(await page.locator('text=Admin token').count(), 0);
  await page.screenshot({ path: `${SHOTS}/login-step1-password.png` });
  await context.close();
});

await check("wrong password gets the generic error", async () => {
  const { context, page } = await freshPage();
  await page.goto(BASE + "/admin");
  await page.fill('input[autocomplete="username"]', USERNAME);
  await page.fill('input[type="password"]', "definitely-wrong-password");
  await page.click('button[type="submit"]');
  await page.waitForSelector('[role="alert"]');
  assert.match(await page.textContent('[role="alert"]'), /Username or password is not right/);
  await context.close();
});

await check("password + TOTP signs in; wrong code does not", async () => {
  const { context, page } = await freshPage();
  await page.goto(BASE + "/admin");
  await page.fill('input[autocomplete="username"]', USERNAME);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('input[autocomplete="one-time-code"]');
  await page.screenshot({ path: `${SHOTS}/login-step2-totp.png` });
  await page.fill('input[autocomplete="one-time-code"]', "000000");
  await page.click('button[type="submit"]');
  await page.waitForSelector('[role="alert"]');
  assert.match(await page.textContent('[role="alert"]'), /That code is not right/);
  await page.fill('input[autocomplete="one-time-code"]', totp(secret));
  await page.click('button[type="submit"]');
  await page.waitForSelector('button:has-text("Sign out")');
  // signed-in visit to old /login lands on the panel at /admin (no loop)
  await page.goto(BASE + "/login");
  await page.waitForURL("**/admin");
  await page.waitForSelector("text=Articles");
  // session is a normal desk session: admin pages load, sign-out revokes
  await page.goto(BASE + "/admin/articles");
  await page.waitForSelector("text=Articles");
  await page.click('button:has-text("Sign out")');
  await page.waitForURL("**/admin");
  await page.waitForSelector('text=Sign in');
  const resp = await context.request.get(BASE + "/admin", { maxRedirects: 0 });
  assert.equal(resp.status(), 200, "signed-out /admin renders sign-in inline");
  assert.ok(!(await resp.text()).includes("Live counts from your site."), "signed-out session no longer opens the desk");
  await context.close();
});

await check("recovery code signs in once; replaying it fails, the next one works", async () => {
  const { context, page } = await freshPage();
  const signInWith = async (code) => {
    await page.goto(BASE + "/admin");
    await page.fill('input[autocomplete="username"]', USERNAME);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForSelector('input[autocomplete="one-time-code"]');
    await page.fill('input[autocomplete="one-time-code"]', code);
    await page.click('button[type="submit"]');
  };
  await signInWith(recoveryCodes[0]);
  await page.waitForSelector('button:has-text("Sign out")');
  await page.click('button:has-text("Sign out")');
  await page.waitForURL("**/admin");
  await page.waitForSelector('text=Sign in');
  await signInWith(recoveryCodes[0]);
  await page.waitForSelector('[role="alert"]');
  assert.match(await page.textContent('[role="alert"]'), /That code is not right/);
  await page.fill('input[autocomplete="one-time-code"]', recoveryCodes[1]);
  await page.click('button[type="submit"]');
  await page.waitForSelector('button:has-text("Sign out")');
  await context.close();
});

await check("sign-in rate limit stops brute force (5/min per IP)", async () => {
  const { context, page } = await freshPage();
  await page.goto(BASE + "/admin");
  let limited = "";
  for (let i = 0; i < 7 && !limited; i += 1) {
    await page.fill('input[autocomplete="username"]', USERNAME);
    await page.fill('input[type="password"]', `wrong-password-${i}`);
    await page.click('button[type="submit"]');
    await page.waitForSelector('[role="alert"]');
    const text = await page.textContent('[role="alert"]');
    if (/Too many attempts/.test(text ?? "")) limited = text;
  }
  assert.ok(limited, "rate limit message appeared");
  await context.close();
});

await check("MCP machine auth untouched: /mcp without a token is refused", async () => {
  const { context } = await freshPage();
  const resp = await context.request.post(BASE + "/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  assert.ok([401, 403].includes(resp.status()), `status ${resp.status()}`);
  await context.close();
});

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall password-login checks passed");
process.exit(failures ? 1 : 0);
