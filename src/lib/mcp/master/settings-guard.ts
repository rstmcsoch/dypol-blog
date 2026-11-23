/**
 * Sanitises website-configuration and ads patches from the Master MCP.
 * Forbidden fields are rejected (not silently dropped) so the agent gets an
 * explicit explanation. Pure helpers (tested).
 */
import { denyMaster, MASTER_FORBIDDEN_SITE_KEYS } from "./permissions.ts";

const FORBIDDEN_SITE = new Set<string>(MASTER_FORBIDDEN_SITE_KEYS);

/** Other top-level keys that would reach security or infrastructure. */
const FORBIDDEN_ALIASES: Record<string, string> = {
  customHead: "update_custom_head",
  custom_head: "update_custom_head",
  headCode: "update_custom_head",
  adminToken: "access_secrets",
  ADMIN_TOKEN: "access_secrets",
  adminSessionSecret: "access_secrets",
  ADMIN_SESSION_SECRET: "access_secrets",
  mcpToken: "access_secrets",
  MCP_TOKEN: "access_secrets",
  workerSecrets: "modify_worker_secrets",
  env: "modify_env",
  bindings: "modify_bindings",
  schema: "modify_schema",
  grants: "manage_admin_grants",
  adminUsers: "manage_admin_accounts",
  security: "access_security",
  totp: "change_2fa",
  recoveryCodes: "change_recovery",
  password: "change_admin_password",
  username: "change_admin_username",
};

export function assertSitePatchAllowed(patch: Record<string, unknown>): void {
  for (const key of Object.keys(patch)) {
    const op = FORBIDDEN_ALIASES[key] ?? (FORBIDDEN_SITE.has(key) ? "update_custom_head" : null);
    if (op) denyMaster(op);
  }
}

export type AdsScriptSnapshot = {
  scripts: unknown;
  /** Map of slot/creative id → html, for change detection. */
  htmlByKey: Record<string, string>;
};

/**
 * Allow structured ad updates. Reject new or changed executable html/scripts
 * unless they exactly match the current configuration or a historical version
 * the owner already saved (restore).
 */
export function assertAdsPatchAllowed(input: {
  next: AdsScriptSnapshot;
  current: AdsScriptSnapshot;
  historical?: AdsScriptSnapshot[];
}): void {
  if (sameSnapshot(input.next, input.current)) return;
  if ((input.historical ?? []).some((h) => sameSnapshot(input.next, h))) return;
  if (jsonStable(input.next.scripts) !== jsonStable(input.current.scripts)) {
    denyMaster("update_unrestricted_ad_scripts");
  }
  const keys = new Set([...Object.keys(input.next.htmlByKey), ...Object.keys(input.current.htmlByKey)]);
  for (const key of keys) {
    const a = (input.next.htmlByKey[key] ?? "").trim();
    const b = (input.current.htmlByKey[key] ?? "").trim();
    if (a !== b) denyMaster("update_unrestricted_ad_scripts");
  }
}

function sameSnapshot(a: AdsScriptSnapshot, b: AdsScriptSnapshot): boolean {
  return jsonStable(a.scripts) === jsonStable(b.scripts) && jsonStable(a.htmlByKey) === jsonStable(b.htmlByKey);
}

function jsonStable(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) out[key] = sortValue((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

export function collectAdsSnapshot(raw: unknown): AdsScriptSnapshot {
  const htmlByKey: Record<string, string> = {};
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const scripts = root.scripts ?? [];
  walk(raw, "", htmlByKey);
  return { scripts, htmlByKey };
}

function walk(value: unknown, path: string, htmlByKey: Record<string, string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, htmlByKey));
    return;
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec.html === "string" && rec.html.trim()) {
    const id = typeof rec.id === "string" && rec.id.trim() ? rec.id : path || "html";
    htmlByKey[id] = rec.html;
  }
  if (typeof rec.code === "string" && /<script|javascript:/i.test(rec.code)) {
    const id = typeof rec.id === "string" && rec.id.trim() ? `${rec.id}:code` : `${path}:code`;
    htmlByKey[id] = rec.code;
  }
  for (const [k, v] of Object.entries(rec)) {
    if (k === "html" || k === "code") continue;
    walk(v, path ? `${path}.${k}` : k, htmlByKey);
  }
}
