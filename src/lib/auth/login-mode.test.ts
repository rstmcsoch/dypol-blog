import assert from "node:assert/strict";
import test from "node:test";
import { resolveLoginMode, tokenSignInAllowed } from "./login-mode.ts";

test("no admin user yet: token bootstrap login", () => {
  assert.deepEqual(resolveLoginMode({ configured: true, setup: "none" }), { mode: "token", setupPending: false });
  assert.equal(tokenSignInAllowed("none"), true);
});

test("credentials saved but authenticator unconfirmed: token login, flagged half-finished", () => {
  // This is the exact prod state behind t83: username/password saved,
  // totp_enabled still 0. The page must say so, not silently look token-only.
  assert.deepEqual(resolveLoginMode({ configured: true, setup: "pending" }), { mode: "token", setupPending: true });
  assert.equal(tokenSignInAllowed("pending"), true);
});

test("confirmed 2FA: username+password is the root login and the token is refused", () => {
  assert.deepEqual(resolveLoginMode({ configured: true, setup: "active" }), { mode: "password", setupPending: false });
  assert.equal(tokenSignInAllowed("active"), false);
});

test("credential store unreachable: fail-safe to token, never to password", () => {
  assert.deepEqual(resolveLoginMode({ configured: true, setup: "unknown" }), { mode: "token", setupPending: false });
  assert.equal(tokenSignInAllowed("unknown"), true);
});

test("unconfigured deployment stays locked in token mode shape", () => {
  assert.deepEqual(resolveLoginMode({ configured: false, setup: "active" }), { mode: "token", setupPending: false });
});
