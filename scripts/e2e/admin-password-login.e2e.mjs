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

await check("before setup: token login works and Security page offers setup", async () => {
  const { context, page } = await freshPage();
  await page.goto(BASE + "/login");
  await page.waitForSelector('text=Admin token');
  await page.screenshot({ path: `${SHOTS}/login-token-before-setup.png` });
  await page.fill('input[type="password"]', TOKEN);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/admin");
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
  await page.waitForURL("**/login**");
  await context.close();
});

await check("after setup: /login asks username+password, no token field", async () => {
  const { context, page } = await freshPage();
  await page.goto(BASE + "/login");
  await page.waitForSelector('input[autocomplete="username"]');
  assert.equal(await page.locator('text=Admin token').count(), 0);
  await page.screenshot({ path: `${SHOTS}/login-step1-password.png` });
  await context.close();
});

await check("wrong password gets the generic error", async () => {
  const { context, page } = await freshPage();
  await page.goto(BASE + "/login");
  await page.fill('input[autocomplete="username"]', USERNAME);
  await page.fill('input[type="password"]', "definitely-wrong-password");
  await page.click('button[type="submit"]');
  await page.waitForSelector('[role="alert"]');
  assert.match(await page.textContent('[role="alert"]'), /Username or password is not right/);
  await context.close();
});

await check("password + TOTP signs in; wrong code does not", async () => {
  const { context, page } = await freshPage();
  await page.goto(BASE + "/login");
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
  await page.waitForURL("**/admin");
  // session is a normal desk session: admin pages load, sign-out revokes
  await page.goto(BASE + "/admin/articles");
  await page.waitForSelector("text=Articles");
  await page.click('button:has-text("Sign out")');
  await page.waitForURL("**/login**");
  const resp = await context.request.get(BASE + "/admin", { maxRedirects: 0 }).catch(() => null);
  assert.ok(!resp || [302, 307].includes(resp.status()), "signed-out session no longer opens the desk");
  await context.close();
});

await check("recovery code signs in once; replaying it fails, the next one works", async () => {
  const { context, page } = await freshPage();
  const signInWith = async (code) => {
    await page.goto(BASE + "/login");
    await page.fill('input[autocomplete="username"]', USERNAME);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForSelector('input[autocomplete="one-time-code"]');
    await page.fill('input[autocomplete="one-time-code"]', code);
    await page.click('button[type="submit"]');
  };
  await signInWith(recoveryCodes[0]);
  await page.waitForURL("**/admin");
  await page.click('button:has-text("Sign out")');
  await page.waitForURL("**/login**");
  await signInWith(recoveryCodes[0]);
  await page.waitForSelector('[role="alert"]');
  assert.match(await page.textContent('[role="alert"]'), /That code is not right/);
  await page.fill('input[autocomplete="one-time-code"]', recoveryCodes[1]);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/admin");
  await context.close();
});

await check("sign-in rate limit stops brute force (5/min per IP)", async () => {
  const { context, page } = await freshPage();
  await page.goto(BASE + "/login");
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
