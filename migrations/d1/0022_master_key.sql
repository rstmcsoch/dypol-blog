-- Desk-issued bearer for the Default (master) profile.
-- token_hash is SHA-256 only. superseded = 1 means the Cloudflare MCP_TOKEN
-- secret is no longer accepted as a bearer (OAuth signing is unchanged).
-- The table is also created on demand.
create table if not exists automation_master_key (
  id text primary key,
  token_hash text,
  token_hint text,
  superseded integer not null default 0,
  created_at text,
  updated_at text not null
);
