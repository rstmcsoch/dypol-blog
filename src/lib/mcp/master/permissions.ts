/**
 * Master MCP permission model (pure). The UI summary is derived from the same
 * constants the backend uses to reject prohibited operations. Ordinary
 * publishing profiles never receive these privileges — including the default
 * profile authenticated with MCP_TOKEN.
 */
export const MASTER_RESERVED_ID = "master";

export class MasterDenied extends Error {
  readonly code = "master_denied" as const;
  readonly operation: string;
  constructor(operation: string, message: string) {
    super(message);
    this.name = "MasterDenied";
    this.operation = operation;
  }
}

export type PermissionLevel = "Full" | "Full, excluding protected executable code" | "Full, excluding unrestricted executable code" | "Restricted" | "Owner only";

export type PermissionSummaryItem = { area: string; level: PermissionLevel; detail: string };

/** Displayed in Admin → Settings → Master MCP. Must match backend enforcement. */
export const MASTER_PERMISSION_SUMMARY: readonly PermissionSummaryItem[] = [
  { area: "Content management", level: "Full", detail: "Create, edit, publish, unpublish, schedule, revise and delete articles, including published ones, with confirmation for destructive actions." },
  { area: "Publishing management", level: "Full", detail: "Inspect and change publication status, dates, featured flags, SEO, topics, tags, covers and AI-edit permission." },
  { area: "AI automation supervision", level: "Full", detail: "Inspect, pause, resume, enable, disable and reconfigure existing Normal and Special profiles, including writers, sources, schedules and quotas." },
  { area: "Analytics", level: "Full", detail: "Read website, article, topic, traffic and publishing analytics, plus activity and attribution." },
  { area: "Website configuration", level: "Full, excluding protected executable code", detail: "Homepage, site text, appearance, pages, topics, tags, ticker, events and logos. Custom head scripts stay owner-only." },
  { area: "Media management", level: "Full", detail: "List, upload, update metadata, attach, replace covers and remove unused media, using existing validation and reference protection." },
  { area: "Ads management", level: "Full, excluding unrestricted executable code", detail: "Structured slots, schedules, density, consent wording and statistics. New or changed ad JavaScript stays owner-only." },
  { area: "Security and administrator management", level: "Restricted", detail: "No access to the Security section, administrator login, passwords, 2FA, recovery codes, sessions, grants or protected secrets." },
  { area: "Website and infrastructure deletion", level: "Restricted", detail: "Cannot delete the website, Worker, D1 database, R2 bucket, or change Cloudflare ownership, secrets, bindings or schema." },
  { area: "Automation profile and credential lifecycle", level: "Owner only", detail: "Cannot create or delete automation profiles, issue or revoke their API keys or OAuth clients, or create or change Master MCP credentials." },
];

/**
 * Prohibited operations and the exact rejection the Master MCP receives.
 * These are never registered as tools; calling them (or an equivalent settings
 * patch) is rejected server-side with this explanation.
 */
export const MASTER_PROHIBITED: Record<string, string> = {
  delete_website: "The Master MCP cannot delete the website or terminate its deployment. That remains an owner-only infrastructure operation.",
  delete_worker: "The Master MCP cannot delete or destroy the Cloudflare Worker. Infrastructure changes are owner-only.",
  delete_d1: "The Master MCP cannot delete the D1 database. Infrastructure destruction is owner-only.",
  delete_r2: "The Master MCP cannot delete the R2 storage bucket. Infrastructure destruction is owner-only.",
  change_cloudflare_ownership: "The Master MCP cannot change Cloudflare account ownership or infrastructure configuration.",
  access_admin_login: "The Master MCP cannot access, modify or reset the administrator login.",
  access_security: "The Master MCP cannot access the Security section or security-related controls.",
  change_admin_password: "The Master MCP cannot change administrator passwords, usernames, 2FA, recovery codes or active admin sessions.",
  change_admin_username: "The Master MCP cannot change administrator passwords, usernames, 2FA, recovery codes or active admin sessions.",
  change_2fa: "The Master MCP cannot change administrator passwords, usernames, 2FA, recovery codes or active admin sessions.",
  change_recovery: "The Master MCP cannot change administrator passwords, usernames, 2FA, recovery codes or active admin sessions.",
  manage_admin_sessions: "The Master MCP cannot change administrator passwords, usernames, 2FA, recovery codes or active admin sessions.",
  access_secrets: "The Master MCP cannot access, reveal, modify or rotate ADMIN_TOKEN, ADMIN_SESSION_SECRET, MCP_TOKEN or other protected credentials.",
  manage_admin_accounts: "The Master MCP cannot create, remove or modify administrator accounts and authorization grants.",
  manage_admin_grants: "The Master MCP cannot create, remove or modify administrator accounts and authorization grants.",
  create_automation_profile: "The Master MCP cannot create or delete automation profiles. The owner manages profile lifecycle in Admin → AI Automation.",
  delete_automation_profile: "The Master MCP cannot create or delete automation profiles. The owner manages profile lifecycle in Admin → AI Automation.",
  issue_profile_credentials: "The Master MCP cannot generate, reveal, rotate or revoke API keys belonging to other MCP connections.",
  revoke_profile_credentials: "The Master MCP cannot generate, reveal, rotate or revoke API keys belonging to other MCP connections.",
  create_profile_oauth: "The Master MCP cannot create or delete OAuth clients for other automation profiles.",
  delete_profile_oauth: "The Master MCP cannot create or delete OAuth clients for other automation profiles.",
  create_master_connection: "The Master MCP cannot create another Master MCP connection or change its credentials. The owner manages that in Admin → Settings → Master MCP.",
  change_master_credentials: "The Master MCP cannot create another Master MCP connection or change its credentials. The owner manages that in Admin → Settings → Master MCP.",
  modify_worker_secrets: "The Master MCP cannot modify Worker secrets, environment variables, bindings, deployment configuration or database schema.",
  modify_env: "The Master MCP cannot modify Worker secrets, environment variables, bindings, deployment configuration or database schema.",
  modify_bindings: "The Master MCP cannot modify Worker secrets, environment variables, bindings, deployment configuration or database schema.",
  modify_schema: "The Master MCP cannot modify Worker secrets, environment variables, bindings, deployment configuration or database schema.",
  execute_sql: "The Master MCP cannot execute arbitrary SQL or arbitrary code against the server.",
  execute_code: "The Master MCP cannot execute arbitrary SQL or arbitrary code against the server.",
  update_custom_head: "Unrestricted custom head scripts are owner-only. The Master MCP may not add, edit or remove executable head code.",
  update_unrestricted_ad_scripts: "Unrestricted executable ad scripts and arbitrary custom JavaScript are owner-only. The Master MCP may manage structured ad configuration and restore a previously saved configuration, but cannot submit new executable code.",
};

export const MASTER_PROHIBITED_TOOL_NAMES = [
  "execute_sql",
  "run_admin_function",
  "execute_javascript",
  "execute_code",
  "delete_website",
  "delete_worker",
  "delete_database",
  "delete_r2_bucket",
] as const;

export function isReservedMasterId(id: string | null | undefined): boolean {
  return (id ?? "").trim().toLowerCase() === MASTER_RESERVED_ID;
}

export function denyMaster(operation: string): never {
  const message = MASTER_PROHIBITED[operation] ?? "The Master MCP is not permitted to perform that operation. It is reserved for the website owner.";
  throw new MasterDenied(operation, message);
}

export function isMasterDenied(error: unknown): error is MasterDenied {
  return error instanceof MasterDenied || (typeof error === "object" && error !== null && (error as { code?: string }).code === "master_denied");
}

/** Settings / ads keys the Master MCP must never write. */
export const MASTER_FORBIDDEN_SITE_KEYS = ["customHead"] as const;

export const SECRET_NAME_RE = /\b(ADMIN_TOKEN|ADMIN_SESSION_SECRET|MCP_TOKEN|ADMIN_PASSWORD|TOTP|RECOVERY_CODE|SESSION_SECRET)\b/i;

export function looksLikeSecretLeak(value: string): boolean {
  return SECRET_NAME_RE.test(value) && /(value|secret|token)\s*[:=]/i.test(value);
}
