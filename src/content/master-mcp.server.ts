/**
 * Master MCP persistence: credentials, OAuth clients, audit, confirmations,
 * agent tasks and article lifecycle events. Tables are created if missing so
 * the app works before migration 0029 is applied to production D1.
 *
 * Credential lifecycle is for the owner (admin server functions) only.
 * The authenticated Master principal can write audit/task/event rows but
 * must never create, rotate or revoke its own credentials.
 */
import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import { constantTimeEqual } from "@/lib/mcp/auth";
import {
  canAuthenticate,
  hashSecret,
  newMasterConnectionId,
  newMasterToken,
  parseMasterToken,
  secretVersion,
  tokenPrefix,
  type MasterCredentialStatus,
} from "@/lib/mcp/master/credentials";
import { denyMaster } from "@/lib/mcp/master/permissions";
import {
  confirmationExpiresAt,
  confirmationValid,
  newConfirmationToken,
  type ConfirmationAction,
} from "@/lib/mcp/master/deletion";
import {
  assertPendingUpdate,
  assertTransition,
  canProfileWorkTasks,
  isTaskState,
  type TaskPriority,
  type TaskState,
} from "@/lib/mcp/master/tasks";
import type { MasterResolver } from "@/lib/mcp/auth";

export type MasterActor = {
  kind: "master";
  connectionId: string;
  clientName?: string | null;
  via: "bearer" | "oauth";
};

let ready = false;

export async function ensureMasterTables(): Promise<void> {
  if (ready) return;
  const sql = await getSql();
  // Fast path: after migration 0029 is applied, a single lookup avoids ~18
  // serial IAD→D1 round trips (several seconds) on every cold isolate.
  const present = await sql<{ creds: number; col: number }>`
    select
      (select count(*) from sqlite_master where type = 'table' and name = 'master_mcp_credentials') as creds,
      (select count(*) from pragma_table_info('articles') where name = 'published_mode') as col
  `.catch(() => [] as Array<{ creds: number; col: number }>);
  if ((present[0]?.creds ?? 0) > 0 && (present[0]?.col ?? 0) > 0) {
    ready = true;
    return;
  }
  await sql`create table if not exists master_mcp_credentials (
    id text primary key,
    created_at text not null,
    name text not null default 'Master MCP',
    token_hash text unique,
    token_prefix text not null default '',
    status text not null default 'active',
    last_connected_at text,
    last_activity_at text,
    last_client_name text,
    created_by text not null default 'admin',
    revoked_at text,
    deactivated_at text,
    rotated_from text
  )`;
  await sql`create table if not exists master_mcp_oauth_clients (
    id text primary key,
    created_at text not null,
    updated_at text not null,
    name text not null,
    redirect_uris text not null,
    secret_hash text not null,
    secret_hint text not null default '',
    secret_version text not null,
    status text not null default 'active',
    revoked_at text
  )`;
  await sql`create table if not exists master_mcp_audit (
    id text primary key,
    created_at text not null,
    connection_id text,
    client_name text,
    tool_name text not null,
    action text not null,
    resource_type text,
    resource_id text,
    before_json text,
    after_json text,
    success integer not null default 1,
    error text,
    related_article_id text,
    related_profile_id text,
    related_task_id text
  )`;
  await sql`create table if not exists master_mcp_confirmations (
    token_hash text primary key,
    created_at text not null,
    expires_at text not null,
    connection_id text not null,
    action text not null,
    resource_id text not null,
    preview_json text not null
  )`;
  await sql`create table if not exists agent_tasks (
    id text primary key,
    created_at text not null,
    updated_at text not null,
    created_by_connection_id text,
    target_profile_id text not null,
    title text not null,
    instructions text not null,
    article_ids text not null default '[]',
    priority text not null default 'normal',
    deadline_at text,
    status text not null default 'pending',
    claimed_at text,
    claimed_by_auth text,
    completed_at text,
    result_summary text,
    result_article_ids text,
    result_changes text,
    error text
  )`;
  await sql`create table if not exists article_events (
    id text primary key,
    article_id text not null,
    created_at text not null,
    action text not null,
    actor_kind text not null,
    actor_id text,
    client_name text,
    product text,
    detail text
  )`;
  for (const stmt of [
    sql`create index if not exists idx_master_mcp_audit_created on master_mcp_audit (created_at desc)`,
    sql`create index if not exists idx_agent_tasks_profile_status on agent_tasks (target_profile_id, status, created_at desc)`,
    sql`create index if not exists idx_article_events_article on article_events (article_id, created_at desc)`,
  ]) await stmt.catch(() => undefined);
  for (const col of ["last_edited_via", "last_edited_via_client", "last_edited_via_product", "last_edited_at", "last_editor_profile", "created_profile_id", "published_profile_id", "published_mode"]) {
    await sql.query(`alter table articles add column ${col} text`).catch(() => undefined);
  }
  await sql.query(`alter table admin_actions add column actor_kind text`).catch(() => undefined);
  ready = true;
}

type CredRow = {
  id: string;
  created_at: string;
  name: string;
  token_hash: string | null;
  token_prefix: string;
  status: string;
  last_connected_at: string | null;
  last_activity_at: string | null;
  last_client_name: string | null;
  revoked_at: string | null;
  deactivated_at: string | null;
};

export type MasterConnectionView = {
  id: string | null;
  name: string;
  status: MasterCredentialStatus | "absent";
  tokenPrefix: string | null;
  createdAt: string | null;
  lastConnectedAt: string | null;
  lastActivityAt: string | null;
  lastClientName: string | null;
  oauth: { id: string; name: string; status: string; secretHint: string; redirectUris: string[]; createdAt: string } | null;
};

async function loadCredential(): Promise<CredRow | null> {
  await ensureMasterTables();
  const sql = await getSql();
  const rows = await sql<CredRow>`select id, created_at, name, token_hash, token_prefix, status, last_connected_at, last_activity_at, last_client_name, revoked_at, deactivated_at from master_mcp_credentials order by created_at desc limit 1`.catch(() => [] as CredRow[]);
  return rows[0] ?? null;
}

async function loadOauth() {
  await ensureMasterTables();
  const sql = await getSql();
  const rows = await sql<{ id: string; name: string; status: string; secret_hint: string; redirect_uris: string; created_at: string }>`select id, name, status, secret_hint, redirect_uris, created_at from master_mcp_oauth_clients order by created_at desc limit 1`.catch(() => []);
  const row = rows[0];
  if (!row) return null;
  let redirectUris: string[] = [];
  try { redirectUris = JSON.parse(row.redirect_uris) as string[]; } catch { redirectUris = []; }
  return { id: row.id, name: row.name, status: row.status, secretHint: row.secret_hint, redirectUris, createdAt: row.created_at };
}

export async function getMasterConnection(): Promise<MasterConnectionView> {
  const row = await loadCredential();
  const oauth = await loadOauth();
  if (!row) {
    return { id: null, name: "Master MCP", status: "absent", tokenPrefix: null, createdAt: null, lastConnectedAt: null, lastActivityAt: null, lastClientName: null, oauth };
  }
  const status = (["active", "deactivated", "revoked"] as const).includes(row.status as MasterCredentialStatus)
    ? (row.status as MasterCredentialStatus)
    : "revoked";
  return {
    id: row.id,
    name: row.name,
    status,
    tokenPrefix: row.token_prefix || null,
    createdAt: row.created_at,
    lastConnectedAt: row.last_connected_at,
    lastActivityAt: row.last_activity_at,
    lastClientName: row.last_client_name,
    oauth,
  };
}

export async function createMasterCredential(name = "Master MCP"): Promise<{ token: string; prefix: string; id: string }> {
  await ensureMasterTables();
  const existing = await loadCredential();
  if (existing && existing.status === "active") {
    throw new Error("A Master MCP credential already exists. Rotate it to issue a new secret, or revoke it first.");
  }
  const id = newMasterConnectionId();
  const token = newMasterToken(id);
  const hash = await hashSecret(token);
  const prefix = tokenPrefix(token);
  const now = new Date().toISOString();
  const sql = await getSql();
  const label = name.trim().slice(0, 80) || "Master MCP";
  if (existing && existing.status !== "active") {
    await sql`update master_mcp_credentials set id = ${id}, created_at = ${now}, name = ${label}, token_hash = ${hash}, token_prefix = ${prefix}, status = 'active', last_connected_at = null, last_activity_at = null, last_client_name = null, revoked_at = null, deactivated_at = null, rotated_from = ${existing.id} where id = ${existing.id}`;
    return { token, prefix, id };
  }
  await sql`insert into master_mcp_credentials (id, created_at, name, token_hash, token_prefix, status, created_by) values (${id}, ${now}, ${label}, ${hash}, ${prefix}, 'active', 'admin')`;
  return { token, prefix, id };
}

export async function rotateMasterCredential(): Promise<{ token: string; prefix: string; id: string }> {
  const existing = await loadCredential();
  if (!existing || existing.status === "revoked") throw new Error("Create a Master MCP credential first.");
  const id = existing.id;
  const token = newMasterToken(id);
  const hash = await hashSecret(token);
  const prefix = tokenPrefix(token);
  const sql = await getSql();
  await sql`update master_mcp_credentials set token_hash = ${hash}, token_prefix = ${prefix}, status = 'active', revoked_at = null, deactivated_at = null, rotated_from = ${existing.id} where id = ${id}`;
  return { token, prefix, id };
}

export async function deactivateMasterCredential(): Promise<void> {
  const existing = await loadCredential();
  if (!existing) throw new Error("There is no Master MCP credential to deactivate.");
  if (existing.status === "revoked") throw new Error("That credential has been revoked and cannot be deactivated.");
  const sql = await getSql();
  const now = new Date().toISOString();
  await sql`update master_mcp_credentials set status = 'deactivated', deactivated_at = ${now} where id = ${existing.id}`;
}

export async function reactivateMasterCredential(): Promise<void> {
  const existing = await loadCredential();
  if (!existing) throw new Error("There is no Master MCP credential to reactivate.");
  if (existing.status === "revoked") throw new Error("A revoked credential cannot be reactivated. Create a new one.");
  const sql = await getSql();
  await sql`update master_mcp_credentials set status = 'active', deactivated_at = null where id = ${existing.id}`;
}

export async function revokeMasterCredential(): Promise<void> {
  const existing = await loadCredential();
  if (!existing) throw new Error("There is no Master MCP credential to revoke.");
  const sql = await getSql();
  const now = new Date().toISOString();
  await sql`update master_mcp_credentials set status = 'revoked', token_hash = null, revoked_at = ${now} where id = ${existing.id}`;
}

export async function touchMasterConnection(id: string, clientName?: string | null): Promise<void> {
  try {
    await ensureMasterTables();
    const sql = await getSql();
    const now = new Date().toISOString();
    const client = clientName?.trim().slice(0, 120) || null;
    if (client) {
      await sql`update master_mcp_credentials set last_connected_at = coalesce(last_connected_at, ${now}), last_activity_at = ${now}, last_client_name = ${client} where id = ${id} and status = 'active'`;
    } else {
      await sql`update master_mcp_credentials set last_connected_at = coalesce(last_connected_at, ${now}), last_activity_at = ${now} where id = ${id} and status = 'active'`;
    }
  } catch { /* telemetry must never break a tool call */ }
}

export async function masterByToken(presented: string): Promise<{ id: string } | null> {
  const parsed = parseMasterToken(presented);
  if (!parsed) return null;
  await ensureMasterTables();
  const sql = await getSql();
  const rows = await sql<CredRow>`select id, created_at, name, token_hash, token_prefix, status, last_connected_at, last_activity_at, last_client_name, revoked_at, deactivated_at from master_mcp_credentials where id = ${parsed.connectionId} limit 1`.catch(() => [] as CredRow[]);
  const row = rows[0];
  if (!row?.token_hash || !canAuthenticate(row.status)) return null;
  const hash = await hashSecret(presented);
  return constantTimeEqual(hash, row.token_hash) ? { id: row.id } : null;
}

export async function masterOauthStillValid(version: string): Promise<boolean> {
  await ensureMasterTables();
  const sql = await getSql();
  const rows = await sql<{ secret_version: string; status: string }>`select secret_version, status from master_mcp_oauth_clients where status = 'active' order by created_at desc limit 1`.catch(() => []);
  const row = rows[0];
  return Boolean(row && row.status === "active" && constantTimeEqual(row.secret_version, version));
}

export function masterResolver(): MasterResolver {
  return {
    byToken: masterByToken,
    oauthClientStillValid: masterOauthStillValid,
  };
}

export async function issueMasterOauthClient(input: { name: string; redirectUris: string[] }): Promise<{ clientId: string; clientSecret: string; secretHint: string; redirectUris: string[] }> {
  await ensureMasterTables();
  const sql = await getSql();
  const now = new Date().toISOString();
  const { newOauthClientId, newOauthClientSecret } = await import("@/lib/automation/oauth-client");
  const clientId = newOauthClientId();
  const clientSecret = newOauthClientSecret();
  const hash = await hashSecret(clientSecret);
  const hint = `${clientSecret.slice(0, 8)}…`;
  const version = secretVersion(hash);
  const name = input.name.trim().slice(0, 80) || "Master MCP OAuth";
  const uris = JSON.stringify(input.redirectUris);
  await sql`update master_mcp_oauth_clients set status = 'revoked', revoked_at = ${now} where status = 'active'`;
  await sql`insert into master_mcp_oauth_clients (id, created_at, updated_at, name, redirect_uris, secret_hash, secret_hint, secret_version, status)
    values (${clientId}, ${now}, ${now}, ${name}, ${uris}, ${hash}, ${hint}, ${version}, 'active')`;
  return { clientId, clientSecret, secretHint: hint, redirectUris: input.redirectUris };
}

export async function revokeMasterOauthClient(): Promise<void> {
  await ensureMasterTables();
  const sql = await getSql();
  const now = new Date().toISOString();
  await sql`update master_mcp_oauth_clients set status = 'revoked', revoked_at = ${now} where status = 'active'`;
}

export async function masterOauthClientById(clientId: string): Promise<{ id: string; name: string; redirectUris: string[]; secretVersion: string; status: string } | null> {
  await ensureMasterTables();
  const sql = await getSql();
  const rows = await sql<{ id: string; name: string; redirect_uris: string; secret_version: string; status: string; secret_hash: string }>`select id, name, redirect_uris, secret_version, status, secret_hash from master_mcp_oauth_clients where id = ${clientId} limit 1`.catch(() => []);
  const row = rows[0];
  if (!row || row.status !== "active") return null;
  let redirectUris: string[] = [];
  try { redirectUris = JSON.parse(row.redirect_uris) as string[]; } catch { redirectUris = []; }
  return { id: row.id, name: row.name, redirectUris, secretVersion: row.secret_version, status: row.status };
}

export async function authenticateMasterOauthClient(clientId: string, secret: string): Promise<{ id: string; name: string; redirectUris: string[]; secretVersion: string } | null> {
  await ensureMasterTables();
  const sql = await getSql();
  const rows = await sql<{ id: string; name: string; redirect_uris: string; secret_version: string; status: string; secret_hash: string }>`select id, name, redirect_uris, secret_version, status, secret_hash from master_mcp_oauth_clients where id = ${clientId} limit 1`.catch(() => []);
  const row = rows[0];
  if (!row || row.status !== "active") return null;
  if (!constantTimeEqual(await hashSecret(secret), row.secret_hash)) return null;
  let redirectUris: string[] = [];
  try { redirectUris = JSON.parse(row.redirect_uris) as string[]; } catch { redirectUris = []; }
  return { id: row.id, name: row.name, redirectUris, secretVersion: row.secret_version };
}

export type MasterAuditInput = {
  actor: MasterActor;
  toolName: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  before?: unknown;
  after?: unknown;
  success: boolean;
  error?: string;
  relatedArticleId?: string;
  relatedProfileId?: string;
  relatedTaskId?: string;
};

export async function recordMasterAudit(input: MasterAuditInput): Promise<void> {
  try {
    await ensureMasterTables();
    const sql = await getSql();
    const now = new Date().toISOString();
    await sql`insert into master_mcp_audit (
      id, created_at, connection_id, client_name, tool_name, action, resource_type, resource_id,
      before_json, after_json, success, error, related_article_id, related_profile_id, related_task_id
    ) values (
      ${randomUUID()}, ${now}, ${input.actor.connectionId}, ${input.actor.clientName ?? null},
      ${input.toolName.slice(0, 80)}, ${input.action.slice(0, 80)}, ${input.resourceType ?? null}, ${input.resourceId ?? null},
      ${input.before !== undefined ? JSON.stringify(input.before).slice(0, 8000) : null},
      ${input.after !== undefined ? JSON.stringify(input.after).slice(0, 8000) : null},
      ${input.success ? 1 : 0}, ${(input.error ?? "").slice(0, 500) || null},
      ${input.relatedArticleId ?? null}, ${input.relatedProfileId ?? null}, ${input.relatedTaskId ?? null}
    )`;
    const { logAdminAction } = await import("./repository.server");
    const summary = `${input.success ? "" : "Failed: "}${input.action}${input.resourceId ? ` ${input.resourceId}` : ""}`.slice(0, 200);
    await logAdminAction(`master.${input.toolName}`.slice(0, 40), summary);
    await sql`update admin_actions set actor_kind = 'master-mcp' where kind = ${`master.${input.toolName}`.slice(0, 40)} and summary = ${summary} and created_at >= ${now}`.catch(() => undefined);
  } catch (error) {
    console.error("[master-mcp] audit", error instanceof Error ? error.message : "unknown");
  }
}

export async function listMasterAudit(limit = 40): Promise<Array<{
  at: string;
  connectionId: string | null;
  clientName: string | null;
  toolName: string;
  action: string;
  resourceId: string | null;
  success: boolean;
  error: string | null;
}>> {
  await ensureMasterTables();
  const sql = await getSql();
  const cap = Math.max(1, Math.min(limit, 200));
  const rows = await sql<{
    created_at: string; connection_id: string | null; client_name: string | null; tool_name: string;
    action: string; resource_id: string | null; success: number; error: string | null;
  }>`select created_at, connection_id, client_name, tool_name, action, resource_id, success, error from master_mcp_audit order by created_at desc limit ${cap}`.catch(() => []);
  return rows.map((r) => ({
    at: r.created_at,
    connectionId: r.connection_id,
    clientName: r.client_name,
    toolName: r.tool_name,
    action: r.action,
    resourceId: r.resource_id,
    success: Number(r.success) === 1,
    error: r.error,
  }));
}

export async function masterUsageStats(): Promise<{ calls24h: number; failures24h: number; calls7d: number }> {
  await ensureMasterTables();
  const sql = await getSql();
  const day = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const week = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  try {
    const [d, f, w] = await Promise.all([
      sql<{ n: number }>`select count(*) as n from master_mcp_audit where created_at >= ${day}`,
      sql<{ n: number }>`select count(*) as n from master_mcp_audit where created_at >= ${day} and success = 0`,
      sql<{ n: number }>`select count(*) as n from master_mcp_audit where created_at >= ${week}`,
    ]);
    return { calls24h: Number(d[0]?.n ?? 0), failures24h: Number(f[0]?.n ?? 0), calls7d: Number(w[0]?.n ?? 0) };
  } catch {
    return { calls24h: 0, failures24h: 0, calls7d: 0 };
  }
}

export async function issueConfirmation(input: {
  actor: MasterActor;
  action: ConfirmationAction;
  resourceId: string;
  preview: unknown;
}): Promise<{ token: string; expiresAt: string }> {
  await ensureMasterTables();
  const sql = await getSql();
  const token = newConfirmationToken();
  const now = new Date().toISOString();
  const expiresAt = confirmationExpiresAt();
  await sql`insert into master_mcp_confirmations (token_hash, created_at, expires_at, connection_id, action, resource_id, preview_json)
    values (${await hashSecret(token)}, ${now}, ${expiresAt}, ${input.actor.connectionId}, ${input.action}, ${input.resourceId}, ${JSON.stringify(input.preview).slice(0, 8000)})`;
  await sql`delete from master_mcp_confirmations where expires_at < ${now}`.catch(() => undefined);
  return { token, expiresAt };
}

export async function consumeConfirmation(input: {
  token: string;
  action: ConfirmationAction;
  resourceId: string;
}): Promise<{ preview: unknown }> {
  await ensureMasterTables();
  const sql = await getSql();
  const hash = await hashSecret(input.token);
  const rows = await sql<{ action: string; resource_id: string; expires_at: string; preview_json: string }>`select action, resource_id, expires_at, preview_json from master_mcp_confirmations where token_hash = ${hash} limit 1`;
  const row = rows[0];
  if (!row) throw new Error("That confirmation token is not valid. Request a new deletion preview.");
  const check = confirmationValid({ stored: { action: row.action, resourceId: row.resource_id, expiresAt: row.expires_at }, action: input.action, resourceId: input.resourceId });
  if (!check.ok) throw new Error(check.error);
  await sql`delete from master_mcp_confirmations where token_hash = ${hash}`;
  try { return { preview: JSON.parse(row.preview_json) }; } catch { return { preview: row.preview_json }; }
}

type TaskRow = {
  id: string; created_at: string; updated_at: string; created_by_connection_id: string | null;
  target_profile_id: string; title: string; instructions: string; article_ids: string;
  priority: string; deadline_at: string | null; status: string; claimed_at: string | null;
  claimed_by_auth: string | null; completed_at: string | null; result_summary: string | null;
  result_article_ids: string | null; result_changes: string | null; error: string | null;
};

export type AgentTask = {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdByConnectionId: string | null;
  targetProfileId: string;
  title: string;
  instructions: string;
  articleIds: string[];
  priority: TaskPriority;
  deadlineAt: string | null;
  status: TaskState;
  claimedAt: string | null;
  completedAt: string | null;
  resultSummary: string | null;
  resultArticleIds: string[] | null;
  resultChanges: unknown;
  error: string | null;
};

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, 200) : [];
  } catch { return []; }
}

function fromRow(r: TaskRow): AgentTask {
  const status = isTaskState(r.status) ? r.status : "pending";
  const priority = (["low", "normal", "high"] as const).includes(r.priority as TaskPriority) ? (r.priority as TaskPriority) : "normal";
  let resultChanges: unknown = null;
  try { resultChanges = r.result_changes ? JSON.parse(r.result_changes) : null; } catch { resultChanges = r.result_changes; }
  return {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdByConnectionId: r.created_by_connection_id,
    targetProfileId: r.target_profile_id,
    title: r.title,
    instructions: r.instructions,
    articleIds: parseIds(r.article_ids),
    priority,
    deadlineAt: r.deadline_at,
    status,
    claimedAt: r.claimed_at,
    completedAt: r.completed_at,
    resultSummary: r.result_summary,
    resultArticleIds: r.result_article_ids ? parseIds(r.result_article_ids) : null,
    resultChanges,
    error: r.error,
  };
}

export async function createAgentTask(input: {
  actor: MasterActor;
  targetProfileId: string;
  title: string;
  instructions: string;
  articleIds: string[];
  priority?: TaskPriority;
  deadlineAt?: string | null;
}): Promise<AgentTask> {
  await ensureMasterTables();
  const sql = await getSql();
  const now = new Date().toISOString();
  const id = `tsk_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await sql`insert into agent_tasks (
    id, created_at, updated_at, created_by_connection_id, target_profile_id, title, instructions, article_ids, priority, deadline_at, status
  ) values (
    ${id}, ${now}, ${now}, ${input.actor.connectionId}, ${input.targetProfileId}, ${input.title.slice(0, 200)}, ${input.instructions.slice(0, 8000)},
    ${JSON.stringify(input.articleIds.slice(0, 200))}, ${input.priority ?? "normal"}, ${input.deadlineAt ?? null}, 'pending'
  )`;
  return (await getAgentTask(id))!;
}

export async function getAgentTask(id: string): Promise<AgentTask | null> {
  await ensureMasterTables();
  const sql = await getSql();
  const rows = await sql<TaskRow>`select * from agent_tasks where id = ${id} limit 1`.catch(() => [] as TaskRow[]);
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function listAgentTasks(filter: { profileId?: string; status?: TaskState; limit?: number } = {}): Promise<AgentTask[]> {
  await ensureMasterTables();
  const sql = await getSql();
  const cap = Math.max(1, Math.min(filter.limit ?? 50, 200));
  const rows = filter.profileId && filter.status
    ? await sql<TaskRow>`select * from agent_tasks where target_profile_id = ${filter.profileId} and status = ${filter.status} order by created_at desc limit ${cap}`
    : filter.profileId
      ? await sql<TaskRow>`select * from agent_tasks where target_profile_id = ${filter.profileId} order by created_at desc limit ${cap}`
      : filter.status
        ? await sql<TaskRow>`select * from agent_tasks where status = ${filter.status} order by created_at desc limit ${cap}`
        : await sql<TaskRow>`select * from agent_tasks order by created_at desc limit ${cap}`;
  return rows.map(fromRow);
}

export async function updateAgentTask(id: string, patch: { title?: string; instructions?: string; articleIds?: string[]; priority?: TaskPriority; deadlineAt?: string | null }): Promise<AgentTask> {
  const current = await getAgentTask(id);
  if (!current) throw new Error("That task no longer exists.");
  assertPendingUpdate(current.status);
  const sql = await getSql();
  const now = new Date().toISOString();
  const title = patch.title?.slice(0, 200) ?? current.title;
  const instructions = patch.instructions?.slice(0, 8000) ?? current.instructions;
  const articleIds = JSON.stringify(patch.articleIds ?? current.articleIds);
  const priority = patch.priority ?? current.priority;
  const deadline = patch.deadlineAt === undefined ? current.deadlineAt : patch.deadlineAt;
  await sql`update agent_tasks set title = ${title}, instructions = ${instructions}, article_ids = ${articleIds}, priority = ${priority}, deadline_at = ${deadline}, updated_at = ${now} where id = ${id}`;
  return (await getAgentTask(id))!;
}

export async function cancelAgentTask(id: string): Promise<AgentTask> {
  const current = await getAgentTask(id);
  if (!current) throw new Error("That task no longer exists.");
  assertTransition(current.status, "cancelled");
  const sql = await getSql();
  const now = new Date().toISOString();
  await sql`update agent_tasks set status = 'cancelled', updated_at = ${now}, completed_at = ${now} where id = ${id}`;
  return (await getAgentTask(id))!;
}

export async function claimAgentTask(id: string, profileId: string, authLabel: string, profile: { enabled: boolean; paused: boolean }): Promise<AgentTask> {
  const work = canProfileWorkTasks(profile);
  if (!work.ok) throw new Error(work.error);
  const current = await getAgentTask(id);
  if (!current) throw new Error("That task no longer exists.");
  if (current.targetProfileId !== profileId) throw new Error("That task is assigned to a different automation profile.");
  assertTransition(current.status, "claimed");
  const sql = await getSql();
  const now = new Date().toISOString();
  await sql`update agent_tasks set status = 'claimed', claimed_at = ${now}, claimed_by_auth = ${authLabel.slice(0, 80)}, updated_at = ${now} where id = ${id} and status = 'pending'`;
  const next = await getAgentTask(id);
  if (!next || next.status !== "claimed") throw new Error("That task was already claimed or is no longer pending.");
  return next;
}

export async function reportAgentTask(input: {
  id: string;
  profileId: string;
  status: "in_progress" | "completed" | "failed";
  summary?: string;
  articleIds?: string[];
  changes?: unknown;
  error?: string;
}): Promise<AgentTask> {
  const current = await getAgentTask(input.id);
  if (!current) throw new Error("That task no longer exists.");
  if (current.targetProfileId !== input.profileId) throw new Error("That task is assigned to a different automation profile.");
  assertTransition(current.status, input.status);
  const sql = await getSql();
  const now = new Date().toISOString();
  const done = input.status === "completed" || input.status === "failed" ? now : current.completedAt;
  await sql`update agent_tasks set status = ${input.status}, updated_at = ${now}, completed_at = ${done},
    result_summary = ${input.summary?.slice(0, 2000) ?? current.resultSummary},
    result_article_ids = ${input.articleIds ? JSON.stringify(input.articleIds.slice(0, 200)) : (current.resultArticleIds ? JSON.stringify(current.resultArticleIds) : null)},
    result_changes = ${input.changes !== undefined ? JSON.stringify(input.changes).slice(0, 8000) : (current.resultChanges ? JSON.stringify(current.resultChanges) : null)},
    error = ${input.error?.slice(0, 500) ?? current.error}
    where id = ${input.id}`;
  return (await getAgentTask(input.id))!;
}

export async function recordArticleEvent(input: {
  articleId: string;
  action: string;
  actorKind: "admin" | "master-mcp" | "mcp-normal" | "mcp-special";
  actorId?: string | null;
  clientName?: string | null;
  product?: string | null;
  detail?: unknown;
}): Promise<void> {
  try {
    await ensureMasterTables();
    const sql = await getSql();
    await sql`insert into article_events (id, article_id, created_at, action, actor_kind, actor_id, client_name, product, detail)
      values (${randomUUID()}, ${input.articleId}, ${new Date().toISOString()}, ${input.action.slice(0, 40)}, ${input.actorKind}, ${input.actorId ?? null}, ${input.clientName ?? null}, ${input.product ?? null}, ${input.detail !== undefined ? JSON.stringify(input.detail).slice(0, 4000) : null})`;
  } catch (error) {
    console.error("[master-mcp] article event", error instanceof Error ? error.message : "unknown");
  }
}

export async function listArticleEvents(articleId: string, limit = 50): Promise<Array<{
  at: string; action: string; actorKind: string; actorId: string | null; clientName: string | null; product: string | null; detail: unknown;
}>> {
  await ensureMasterTables();
  const sql = await getSql();
  const cap = Math.max(1, Math.min(limit, 200));
  const rows = await sql<{ created_at: string; action: string; actor_kind: string; actor_id: string | null; client_name: string | null; product: string | null; detail: string | null }>`
    select created_at, action, actor_kind, actor_id, client_name, product, detail from article_events where article_id = ${articleId} order by created_at desc limit ${cap}`.catch(() => []);
  return rows.map((r) => {
    let detail: unknown = null;
    try { detail = r.detail ? JSON.parse(r.detail) : null; } catch { detail = r.detail; }
    return { at: r.created_at, action: r.action, actorKind: r.actor_kind, actorId: r.actor_id, clientName: r.client_name, product: r.product, detail };
  });
}

/** Owner-only operations the Master principal might request by name. Always denied here too. */
export function rejectCredentialLifecycle(op: "create_master_connection" | "change_master_credentials"): never {
  return denyMaster(op);
}
