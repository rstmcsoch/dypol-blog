import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_WORKER_NAME,
  PREVIEW_DB_ID,
  PREVIEW_DB_NAME,
  PRODUCTION_DB_ID,
  PRODUCTION_DB_NAME,
  loadWranglerConfig,
  validateWranglerConfig,
  verifyDeployTarget,
} from "./deploy-target.mjs";

test("wrangler.jsonc has valid, isolated production and preview bindings", () => {
  const config = loadWranglerConfig();
  const validation = validateWranglerConfig(config);
  assert.equal(validation.ok, true, validation.errors.join("; "));
  assert.equal(config.name, CANONICAL_WORKER_NAME);
  assert.notEqual(PRODUCTION_DB_ID, PREVIEW_DB_ID);
});

test("production target fails closed when environment is ambiguous", () => {
  const outcome = verifyDeployTarget("production", {});
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /Ambiguous deployment context/);
});

test("production target fails closed on non-main branch even if DYPOL_DEPLOY_TARGET=production", () => {
  const outcome = verifyDeployTarget("production", {
    DYPOL_DEPLOY_TARGET: "production",
    WORKERS_CI_BRANCH: "feat/some-preview",
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /non-production branch/);
});

test("production target fails closed when duplicate legacy Worker dypol-blog is targeted", () => {
  const outcome = verifyDeployTarget("production", {
    DYPOL_DEPLOY_TARGET: "production",
    WORKERS_CI_BRANCH: "main",
    CF_WORKER_NAME: "dypol-blog",
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /dypol-blog/);
});

test("production target succeeds when DYPOL_DEPLOY_TARGET=production or WORKERS_CI_BRANCH=main on dypolblog", () => {
  const byFlag = verifyDeployTarget("production", { DYPOL_DEPLOY_TARGET: "production" });
  assert.equal(byFlag.ok, true);
  assert.equal(byFlag.database, PRODUCTION_DB_NAME);
  assert.equal(byFlag.databaseId, PRODUCTION_DB_ID);

  const byCi = verifyDeployTarget("production", {
    WORKERS_CI_BRANCH: "main",
    CF_WORKER_NAME: "dypolblog",
  });
  assert.equal(byCi.ok, true);
  assert.equal(byCi.database, PRODUCTION_DB_NAME);
});

test("preview target fails closed on main branch or production env", () => {
  const onMain = verifyDeployTarget("preview", { WORKERS_CI_BRANCH: "main" });
  assert.equal(onMain.ok, false);

  const onProdEnv = verifyDeployTarget("preview", {
    DYPOL_DEPLOY_TARGET: "preview",
    DYPOL_ENV: "production",
  });
  assert.equal(onProdEnv.ok, false);
});

test("preview target succeeds on feature branch or explicit preview target and binds preview DB", () => {
  const byBranch = verifyDeployTarget("preview", { WORKERS_CI_BRANCH: "fix/incident-repair" });
  assert.equal(byBranch.ok, true);
  assert.equal(byBranch.database, PREVIEW_DB_NAME);
  assert.equal(byBranch.databaseId, PREVIEW_DB_ID);

  const byFlag = verifyDeployTarget("preview", { DYPOL_DEPLOY_TARGET: "preview" });
  assert.equal(byFlag.ok, true);
  assert.equal(byFlag.database, PREVIEW_DB_NAME);
});
