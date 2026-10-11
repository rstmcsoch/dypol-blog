-- Grok automation (MCP) bookkeeping. Additive only: no existing table changes.
-- Settings live in the existing site_settings table (row id 'automation').

-- One row per accepted draft submission: idempotency + dedupe + provenance.
create table if not exists automation_submissions (
  idempotency_key text primary key,
  content_hash text not null,
  article_id text not null,
  source_urls text not null default '[]',
  flags text not null default '[]',
  provider text not null,
  created_at text not null
);
create index if not exists automation_submissions_hash_idx on automation_submissions (content_hash);
create index if not exists automation_submissions_article_idx on automation_submissions (article_id);

-- Audit log of automation tool calls and run results. Never stores tokens.
create table if not exists automation_runs (
  id text primary key,
  created_at text not null,
  tool text not null,
  outcome text not null,
  reason text not null default '',
  article_id text,
  auth text not null default '',
  details text not null default '{}'
);
create index if not exists automation_runs_created_idx on automation_runs (created_at);
