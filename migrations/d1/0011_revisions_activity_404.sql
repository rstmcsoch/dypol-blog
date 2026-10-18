-- t69: article revisions (history-lite), admin action log, aggregated 404 log.
-- Additive only. Code also creates these tables if missing, so the app
-- degrades gracefully before this migration is applied.
create table if not exists article_revisions (
  id text primary key,
  article_id text not null,
  saved_at text not null,
  title text not null default '',
  status text not null default '',
  snapshot text not null
);
create index if not exists idx_revisions_article on article_revisions (article_id, saved_at desc);

create table if not exists admin_actions (
  id text primary key,
  created_at text not null,
  kind text not null,
  summary text not null
);
create index if not exists idx_admin_actions_created on admin_actions (created_at desc);

create table if not exists not_found_log (
  path text primary key,
  referrer text not null default '',
  hits integer not null default 1,
  first_seen text not null,
  last_seen text not null
);
create index if not exists idx_notfound_hits on not_found_log (hits desc);
