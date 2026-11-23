-- t242: Master MCP — owner-provisioned control-plane identity, audit trail,
-- agent-task queue, and additive article lifecycle provenance.
-- Additive only. Application code also creates these tables if missing, so the
-- app degrades gracefully before Workers Builds (which does not auto-apply D1
-- migrations) has this file applied to production.
--
-- Daily publishing caps continue to use the UTC calendar day, matching the
-- existing website-wide AI publish limit. This is documented in
-- src/lib/automation/publish-limits.ts and docs/automation/README.md.

-- Dedicated Master MCP bearer credentials. Only a SHA-256 hash is stored.
create table if not exists master_mcp_credentials (
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
);
create index if not exists idx_master_mcp_credentials_status on master_mcp_credentials (status);

-- Owner-provisioned confidential OAuth clients bound to the Master identity,
-- never to a publishing profile.
create table if not exists master_mcp_oauth_clients (
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
);

-- Searchable Master MCP audit log. Never stores credentials.
create table if not exists master_mcp_audit (
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
);
create index if not exists idx_master_mcp_audit_created on master_mcp_audit (created_at desc);
create index if not exists idx_master_mcp_audit_tool on master_mcp_audit (tool_name, created_at desc);
create index if not exists idx_master_mcp_audit_resource on master_mcp_audit (resource_type, resource_id);

-- Two-stage confirmation tokens for destructive Master operations.
create table if not exists master_mcp_confirmations (
  token_hash text primary key,
  created_at text not null,
  expires_at text not null,
  connection_id text not null,
  action text not null,
  resource_id text not null,
  preview_json text not null
);
create index if not exists idx_master_mcp_confirmations_expires on master_mcp_confirmations (expires_at);

-- Persistent task queue so the Master MCP can assign correction work to
-- publishing profiles that are not running continuously.
create table if not exists agent_tasks (
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
);
create index if not exists idx_agent_tasks_profile_status on agent_tasks (target_profile_id, status, created_at desc);
create index if not exists idx_agent_tasks_status on agent_tasks (status, created_at desc);

-- Article-level lifecycle events (creator / editor / publisher trail).
-- Complements articles.created_via / published_via from migration 0028.
create table if not exists article_events (
  id text primary key,
  article_id text not null,
  created_at text not null,
  action text not null,
  actor_kind text not null,
  actor_id text,
  client_name text,
  product text,
  detail text
);
create index if not exists idx_article_events_article on article_events (article_id, created_at desc);
create index if not exists idx_article_events_created on article_events (created_at desc);

-- Additive article provenance columns. Existing rows stay null.
-- last_edited_* may be overwritten on each edit; created_profile_id and
-- published_profile_id / published_mode are first-write-wins in application code.
alter table articles add column last_edited_via text;
alter table articles add column last_edited_via_client text;
alter table articles add column last_edited_via_product text;
alter table articles add column last_edited_at text;
alter table articles add column last_editor_profile text;
alter table articles add column created_profile_id text;
alter table articles add column published_profile_id text;
alter table articles add column published_mode text;

-- Distinguish administrator vs Master MCP rows in the existing activity feed.
alter table admin_actions add column actor_kind text;

-- Contact messages already have `handled`; no schema change required there.
