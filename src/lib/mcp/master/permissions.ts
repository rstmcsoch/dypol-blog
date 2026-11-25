/**
 * Master MCP permission model (pure). The UI summary and toggles are derived
 * from the same constants the backend uses to enforce permissions and reject
 * prohibited operations. Ordinary publishing profiles never receive these
 * privileges — including the default profile authenticated with MCP_TOKEN.
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

export type MasterPermissionKey =
  | "content"
  | "publishing"
  | "automation"
  | "analytics"
  | "config"
  | "media"
  | "ads";

export type MasterPermissionsMap = Record<MasterPermissionKey, boolean>;

export const DEFAULT_MASTER_PERMISSIONS: MasterPermissionsMap = {
  content: true,
  publishing: true,
  automation: true,
  analytics: true,
  config: true,
  media: true,
  ads: true,
};

export const MASTER_TOGGLEABLE_PERMISSIONS: readonly { key: MasterPermissionKey; label: string }[] = [
  { key: "content", label: "Content management" },
  { key: "publishing", label: "Publishing management" },
  { key: "automation", label: "AI automation supervision" },
  { key: "analytics", label: "Analytics & reporting" },
  { key: "config", label: "Website configuration" },
  { key: "media", label: "Media management" },
  { key: "ads", label: "Ads management" },
];

export const MASTER_LOCKED_PERMISSIONS: readonly { key: string; label: string }[] = [
  { key: "security", label: "Security & admin accounts" },
  { key: "infrastructure", label: "Site & infrastructure deletion" },
  { key: "credentials", label: "Master & profile credentials" },
];

export const MASTER_TOOL_PERMISSION: Readonly<Record<string, MasterPermissionKey>> = {
  // Content management
  list_all_articles: "content",
  get_full_article: "content",
  create_article: "content",
  update_article: "content",
  duplicate_article: "content",
  preview_article_deletion: "content",
  delete_article: "content",
  list_article_revisions: "content",
  restore_article_revision: "content",

  // Publishing management
  publish_article: "publishing",
  schedule_article: "publishing",
  unpublish_article: "publishing",
  set_article_ai_edit_permission: "publishing",

  // AI automation supervision & agent tasks
  list_automation_profiles: "automation",
  get_automation_profile: "automation",
  update_automation_profile: "automation",
  set_automation_status: "automation",
  update_automation_publishing_limits: "automation",
  update_automation_topics: "automation",
  update_automation_sources: "automation",
  update_automation_schedule: "automation",
  manage_automation_authors: "automation",
  get_automation_usage: "automation",
  assign_agent_task: "automation",
  list_agent_tasks: "automation",
  get_agent_task: "automation",
  update_agent_task: "automation",
  cancel_agent_task: "automation",
  get_agent_task_results: "automation",

  // Analytics & reporting
  get_analytics_overview: "analytics",
  get_article_analytics: "analytics",
  get_topic_analytics: "analytics",
  get_traffic_sources: "analytics",
  get_automation_analytics: "analytics",
  get_publishing_history: "analytics",
  get_daily_publishing_report: "analytics",

  // Website configuration
  get_website_settings: "config",
  update_website_settings: "config",
  get_homepage_configuration: "config",
  update_homepage_configuration: "config",
  update_site_text: "config",
  update_appearance: "config",
  manage_pages: "config",
  manage_topics: "config",
  manage_tags: "config",
  manage_ticker: "config",
  manage_events: "config",
  list_contact_messages: "config",

  // Media management
  manage_media: "media",

  // Ads management
  manage_ads: "ads",
};

export function normalizeMasterPermissions(raw: unknown): MasterPermissionsMap {
  const out: MasterPermissionsMap = { ...DEFAULT_MASTER_PERMISSIONS };
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const item of MASTER_TOGGLEABLE_PERMISSIONS) {
    if (typeof src[item.key] === "boolean") {
      out[item.key] = src[item.key] as boolean;
    }
  }
  return out;
}

export function permissionForTool(toolName: string): MasterPermissionKey | null {
  return MASTER_TOOL_PERMISSION[toolName] ?? null;
}

export function permissionLabel(key: MasterPermissionKey): string {
  return MASTER_TOGGLEABLE_PERMISSIONS.find((p) => p.key === key)?.label ?? key;
}

export type PermissionLevel = "Full" | "Full, excluding protected executable code" | "Full, excluding unrestricted executable code" | "Restricted" | "Owner only";

export type PermissionSummaryItem = { area: string; level: PermissionLevel; detail: string };

/** Displayed in Admin → Settings → Master MCP & returned by get_master_permissions. */
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
