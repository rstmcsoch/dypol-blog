#!/usr/bin/env node
/**
 * Automation storage/page/action/tick smoke test. Runs only against a local
 * Wrangler/Vite server and its local D1 fixture. It creates a run-history row
 * through the explicit dry-run action, but never writes or publishes an article.
 *
 * Example:
 *   ADMIN_TOKEN=<local-token> CRON_SECRET=<local-cron-token> \
 *     BASE=http://127.0.0.1:8080 npm run test:e2e:automation
 */
import assert from "node:assert/strict";
import { issueSession, sessionKey } from "../../src/lib/auth/session-token.ts";
import { fromCrossJSON, toJSONAsync } from "seroval";
import { createDefaultSerovalPlugins } from "@tanstack/router-core/ssr/client";

const BASE = process.env.BASE ?? "http://127.0.0.1:8080";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const AUTOMATION_ID = process.env.AUTOMATION_ID ?? "default";
const baseUrl = new URL(BASE);
assert.ok(["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname), "this test is local-only; BASE must use localhost");
assert.ok(ADMIN_TOKEN.length >= 16, "set ADMIN_TOKEN to the local Wrangler test token");
assert.ok(CRON_SECRET.length >= 16, "set CRON_SECRET to the local Wrangler test token");

const session = await issueSession(sessionKey(ADMIN_TOKEN, process.env.ADMIN_SESSION_SECRET));
const cookie = `dypol_desk=${session}; dypol_desk_theme=dark`;
const authHeaders = { cookie };

async function page(path) {
  const response = await fetch(new URL(path, BASE), { headers: authHeaders });
  const html = await response.text();
  assert.equal(response.status, 200, `${path} should render (got ${response.status})`);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  return html;
}

async function serverFunction(name, data) {
  const sourceResponse = await fetch(new URL("/src/content/admin-api.ts", BASE));
  assert.equal(sourceResponse.status, 200, "local Vite server-function source should be available");
  const source = await sourceResponse.text();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = `export const ${escaped} = createServerFn\\(\\{ method: "POST" \\}\\)\\.handler\\(createClientRpc\\("([^"]+)"\\)\\)`;
  const match = new RegExp(pattern).exec(source);
  assert.ok(match?.[1], `${name} server function should be registered in the local dev bundle`);

  const payload = await toJSONAsync({ data });
  const response = await fetch(new URL(`/_serverFn/${encodeURIComponent(match[1])}`, BASE), {
    method: "POST",
    headers: {
      ...authHeaders,
      origin: BASE,
      "content-type": "application/json",
      "x-tsr-serverFn": "true",
    },
    body: JSON.stringify(payload),
  });
  const raw = await response.json();
  const result = fromCrossJSON(raw, { plugins: createDefaultSerovalPlugins() });
  if (!response.ok) throw new Error(`Server function ${name} returned ${response.status}: ${JSON.stringify(result)}`);
  if (result.error) throw result.error;
  return result.result;
}

const automationPage = await page("/admin/automation");
assert.match(automationPage, /Automations/);
assert.match(automationPage, /History &amp; diagnostics/);
assert.match(automationPage, /Run now/);
assert.match(automationPage, /Dry run/);

const historyPage = await page("/admin/automation/history");
assert.match(historyPage, /History &amp; diagnostics/);
assert.match(historyPage, /Run controls/);
assert.match(historyPage, /aria-label="Dry run/);

// This exercises the authorized admin action independently from the page
// renderer. A dry run is the only article-generation path used by this test.
const run = await serverFunction("adminRunAutomation", { id: AUTOMATION_ID, dryRun: true });
assert.equal(run.ok, true);
assert.ok(run.outcome && typeof run.outcome.status === "string");
assert.notEqual(run.outcome.status, "failed", run.outcome.reason);

// Exercise the History query after the action and confirm the run was recorded.
const history = await serverFunction("adminAutomationRuns", { automationId: AUTOMATION_ID, limit: 20 });
assert.ok(Array.isArray(history.runs));
assert.ok(history.runs.some((item) => item.automationId === AUTOMATION_ID), "the run action should be visible in History");

// Exercise the protected scheduled-job HTTP route in dry-run mode. No article
// is saved or published by this URL; only scheduler/run diagnostics may change.
const unauthorized = await fetch(new URL("/api/automation/tick?dry=1", BASE));
assert.equal(unauthorized.status, 401, "the tick endpoint must reject an unauthorised request");
const tickResponse = await fetch(new URL(`/api/automation/tick?automation=${encodeURIComponent(AUTOMATION_ID)}&force=1&dry=1`, BASE), {
  headers: { authorization: `Bearer ${CRON_SECRET}` },
});
const tick = await tickResponse.json();
assert.equal(tickResponse.status, 200, JSON.stringify(tick));
assert.ok(tick.outcome && typeof tick.outcome.status === "string", "authorized dry-run tick returns a run outcome");

console.log("ok - automation and history pages render from local D1");
console.log("ok - authorized dry-run action and History query work");
console.log("ok - protected tick route rejects anonymous calls and accepts dry-run calls");
