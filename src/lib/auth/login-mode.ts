/**
 * Root sign-in mode decision (t83) — pure, node-testable.
 *
 * The /login page must never guess. It asks the server which state the
 * credential store is in and renders exactly one primary form:
 *
 *   setup "active"   (a row with totp_enabled = 1)  -> username + password,
 *                                                      then TOTP/recovery
 *   setup "pending"  (credentials saved, no confirmed
 *                     authenticator yet)             -> ADMIN_TOKEN form
 *                                                      (bootstrap), visibly
 *                                                      labelled half-finished
 *   setup "none"     (no admin_users row)            -> ADMIN_TOKEN (bootstrap)
 *   setup "unknown"  (credential store unreachable)  -> ADMIN_TOKEN (fail-safe:
 *                                                      bricking the owner's
 *                                                      access is worse; the
 *                                                      failure is logged
 *                                                      server-side)
 *
 * Emergency recovery is unchanged and documented in docs/ADMIN-GUIDE.md:
 * deleting the admin_users row(s) in D1 returns the site to "none", so
 * token sign-in comes back. There is no hidden token back-door while a
 * confirmed (totp_enabled = 1) admin user exists.
 */
export type PasswordSetupState = "active" | "pending" | "none" | "unknown";

export interface LoginModeDecision {
  mode: "password" | "token";
  /** Credentials exist but no authenticator was ever confirmed. */
  setupPending: boolean;
}

export function resolveLoginMode(input: { configured: boolean; setup: PasswordSetupState }): LoginModeDecision {
  if (input.configured && input.setup === "active") return { mode: "password", setupPending: false };
  return { mode: "token", setupPending: input.setup === "pending" };
}

/** The shared ADMIN_TOKEN may start a session only before 2FA is confirmed. */
export function tokenSignInAllowed(setup: PasswordSetupState): boolean {
  return setup !== "active";
}
