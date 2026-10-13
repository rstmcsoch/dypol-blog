-- Independent automations, durable schedules, richer run history and a real
-- popularity metric. Additive only: no existing table is dropped or recreated
-- and the legacy site_settings row 'automation' is migrated on read
-- (src/lib/automation/store.server.ts), never in SQL.

-- ---------------------------------------------------------------- automations
-- One row per automation. Every column a setting; nothing is global any more.
create table if not exists automations (
  id text primary key,
  name text not null,
  enabled integer not null default 0,
  paused integer not null default 0,
  mode text not null default 'mcp-connector',
  provider text not null default 'openai',
  model text not null default '',
  base_url text not null default '',
  -- Name of the Worker secret this automation is allowed to use, or '' for none.
  -- Never the key itself: key material lives only in Worker secrets.
  credential_ref text not null default '',
  topic_source text not null default 'ideas',
  topic_ideas text not null default '[]',
  topic_sources text not null default '[]',
  category_id text,
  tag_ids text not null default '[]',
  language text not null default 'en',
  style text not null default 'editorial',
  instructions text not null default '',
  min_words integer not null default 600,
  image_mode text not null default 'none',
  image_prompt text not null default '',
  publish_mode text not null default 'draft',
  schedule_cron text not null default '',
  timezone text not null default 'UTC',
  max_per_day integer not null default 1,
  retry_max integer not null default 2,
  retry_backoff_seconds integer not null default 60,
  require_sources integer not null default 1,
  min_sources integer not null default 2,
  require_cover integer not null default 0,
  allowed_category_ids text not null default '[]',
  mcp_default integer not null default 0,
  sort_order integer not null default 0,
  created_at text not null,
  updated_at text not null
);

create unique index if not exists automations_name_key on automations (name);
create index if not exists automations_enabled_idx on automations (enabled, paused);

-- ------------------------------------------------------------ schedule / locks
-- Durable schedule state: schedules survive deploys and restarts because they
-- live here, not in memory. The lock columns make duplicate execution of one
-- scheduled event impossible (single UPDATE ... WHERE claim).
create table if not exists automation_schedule (
  automation_id text primary key,
  next_run_at text,
  last_run_at text,
  last_status text not null default '',
  last_reason text not null default '',
  locked_until text,
  lock_token text,
  failure_streak integer not null default 0,
  updated_at text not null
);

create index if not exists automation_schedule_due_idx on automation_schedule (next_run_at);

-- ------------------------------------------------------------- run log columns
-- The existing automation_runs table keeps every legacy row; new columns are
-- additive so old MCP-only rows still read.
alter table automation_runs add column automation_id text;
alter table automation_runs add column stage text not null default '';
alter table automation_runs add column status text not null default '';
alter table automation_runs add column duration_ms integer not null default 0;
alter table automation_runs add column attempt integer not null default 1;
alter table automation_runs add column finished_at text;

create index if not exists automation_runs_automation_idx on automation_runs (automation_id, created_at);
create index if not exists automation_runs_status_idx on automation_runs (status, created_at);

-- ------------------------------------------------------------- popularity data
-- A genuine, cookie-less view metric: one row per article per UTC day. Powers
-- "Trending" (last N days) and "Popular" (all time) honestly instead of
-- guessing. No personal data is stored.
create table if not exists article_views (
  article_id text not null,
  day text not null,
  count integer not null default 0,
  primary key (article_id, day)
);

create index if not exists article_views_day_idx on article_views (day, count);
