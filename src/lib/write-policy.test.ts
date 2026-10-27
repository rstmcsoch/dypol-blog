import assert from "node:assert/strict";
import test from "node:test";
import { isVersionPreviewHost, sameOriginRequest, writesAllowedFor } from "./write-policy.ts";

test("version-preview hosts of the production Worker are detected", () => {
  assert.equal(isVersionPreviewHost("4718b35c-dypolblog.rstmcsoch.workers.dev"), true);
  assert.equal(isVersionPreviewHost("dypolblog.rstmcsoch.workers.dev"), false);
  assert.equal(isVersionPreviewHost("blog.dypol.workers.dev"), false);
  assert.equal(isVersionPreviewHost("blog.dypollabs.com"), false);
});

test("writes are blocked on production-bound version previews and when forced off", () => {
  assert.equal(writesAllowedFor({ env: "production", host: "dypolblog.rstmcsoch.workers.dev" }), true);
  assert.equal(writesAllowedFor({ env: "production", host: "blog.dypol.workers.dev" }), true);
  assert.equal(writesAllowedFor({ env: "production", host: "4718b35c-dypolblog.rstmcsoch.workers.dev" }), false);
  assert.equal(writesAllowedFor({ env: undefined, host: "5c785677-dypol-blog.rstmcsoch.workers.dev" }), false);
  assert.equal(writesAllowedFor({ env: "preview", host: "admin-panel-d1-dypolblog.rstmcsoch.workers.dev" }), true);
  assert.equal(writesAllowedFor({ env: "preview", writes: "off", host: "x.example" }), false);
  assert.equal(writesAllowedFor({ env: "production", writes: "OFF", host: "blog.example" }), false);
});

function req(url: string, headers: Record<string, string>) {
  const h = new Headers(headers);
  return { url, headers: { get: (n: string) => h.get(n) } };
}

test("cross-site requests are rejected, same-origin accepted", () => {
  const url = "https://dypolblog.rstmcsoch.workers.dev/_serverFn/x";
  assert.equal(sameOriginRequest(req(url, { origin: "https://dypolblog.rstmcsoch.workers.dev" })), true);
  assert.equal(sameOriginRequest(req(url, { origin: "https://evil.example" })), false);
  assert.equal(sameOriginRequest(req(url, { "sec-fetch-site": "cross-site" })), false);
  assert.equal(sameOriginRequest(req(url, { "sec-fetch-site": "same-site", origin: "https://other.rstmcsoch.workers.dev" })), false);
  assert.equal(sameOriginRequest(req(url, { origin: "null" })), false);
  assert.equal(sameOriginRequest(req(url, {})), true);
});
