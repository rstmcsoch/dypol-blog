-- Round 3: multiple automation profiles + a privacy-friendly view counter.
-- Additive only: two new tables and two new nullable columns. Existing rows
-- keep working (profile_id NULL = the default profile).

create table if not exists automation_profiles (
  id text primary key,
  name text not null,
  settings text not null default '{}',
  -- sha256 of the profile's MCP token (never the token itself); NULL = no token
  token_hash text,
  -- last 4 characters, to help the owner recognise which token is set
  token_hint text,
  token_created_at text,
  created_at text not null,
  updated_at text not null
);

alter table automation_runs add column profile_id text;
alter table automation_submissions add column profile_id text;
create index if not exists automation_runs_profile_idx on automation_runs (profile_id, created_at);

-- One integer per article. No IPs, cookies or per-visit rows.
create table if not exists article_views (
  article_id text primary key,
  views integer not null default 0,
  updated_at text not null
);
