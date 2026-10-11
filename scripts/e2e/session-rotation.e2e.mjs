#!/usr/bin/env node
/**
 * Session rotation E2E. Starts `wrangler dev` (local D1/R2) several times with
 * different secrets and checks that a cookie issued under one set of secrets is
 * rejected once ADMIN_SESSION_SECRET or ADMIN_TOKEN changes.
 *
 *   npm run build && npm run test:e2e:rotation
 *
 * Writes .dev.vars while running and restores the previous one afterwards.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, request as pwRequest } from "playwright";

const PORT = Number(process.env.PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN_A = "rotation-token-aaaaaaaaaaaa";
const TOKEN_B = "rotation-token-bbbbbbbbbbbb";
const saved = existsSync(".dev.vars") ? readFileSync(".dev.vars", "utf8") : null;

async function withServer(vars, fn) {
  writeFileSync(".dev.vars", Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  const child = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1"], { stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  try {
    for (let i = 0; i < 120 && !/Ready on/.test(log); i += 1) await new Promise((r) => setTimeout(r, 500));
    assert.match(log, /Ready on/, "wrangler dev started");
    return await fn();
  } finally {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function signIn(token) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE + "/login");
  await page.fill('input[type="password"]', token);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin$/);
  const cookie = (await context.cookies()).find((c) => c.name === "dypol_desk").value;
  await browser.close();
  return cookie;
}

async function adminStatus(cookie) {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const r = await ctx.get("/admin", { headers: { cookie: `dypol_desk=${cookie}` }, maxRedirects: 0 });
  await ctx.dispose();
  return r.status();
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); } catch (e) { failures += 1; console.log(`not ok - ${name}\n  ${e.message}`); }
}

try {
  const original = { ADMIN_TOKEN: TOKEN_A, ADMIN_SESSION_SECRET: "session-secret-one-1234567890" };
  const cookie = await withServer(original, async () => {
    const c = await signIn(TOKEN_A);
    await check("cookie works on the server that issued it", async () => assert.equal(await adminStatus(c), 200));
    return c;
  });
  await withServer({ ...original, ADMIN_SESSION_SECRET: "session-secret-two-0987654321" }, () =>
    check("old cookie rejected after rotating ADMIN_SESSION_SECRET", async () => assert.equal(await adminStatus(cookie), 307)));
  await withServer({ ...original, ADMIN_TOKEN: TOKEN_B }, () =>
    check("old cookie rejected after rotating ADMIN_TOKEN", async () => assert.equal(await adminStatus(cookie), 307)));
  await withServer({ ADMIN_TOKEN: TOKEN_A }, () =>
    check("old cookie rejected after removing ADMIN_SESSION_SECRET", async () => assert.equal(await adminStatus(cookie), 307)));
  await withServer(original, () =>
    check("same secrets after a restart still accept it (rejection is due to the secret, not the restart)", async () =>
      assert.equal(await adminStatus(cookie), 200)));
} finally {
  if (saved === null) writeFileSync(".dev.vars", ""); else writeFileSync(".dev.vars", saved);
}
if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall session rotation checks passed");
