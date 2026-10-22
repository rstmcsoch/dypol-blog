-- t96: first-party editorial analytics rollups (D1).
--
-- Compact, bounded aggregates only. No per-visit raw events, no IP addresses,
-- no user agents, no cookies, no scroll-by-scroll event log. Every table is a
-- rollup keyed by article/session/date so row count stays bounded
-- (articles x sessions per day) and rows older than 90 days are purged when
-- an administrator opens the Stats dashboard.
--
-- Dates are Asia/Kolkata calendar dates (UTC+5:30), the dashboard's default
-- reporting timezone. Timestamps are stored as ISO-8601 UTC.

-- One row per visitor session. session_id is a random identifier kept in a
-- first-party cookie on the reader's browser (30 days). It is not linked to
-- any identity and never leaves this database.
create table if not exists analytics_sessions (
  session_id text primary key,
  started_at text not null,      -- ISO-8601 UTC, first beacon of this session
  last_seen text not null,       -- ISO-8601 UTC, most recent beacon
  source text not null default 'direct',
  medium text not null default 'none',
  referrer_domain text not null default '',
  device_category text not null default 'desktop',
  page_views integer not null default 0,
  engaged_seconds real not null default 0,
  bounced integer not null default 0
);
create index if not exists idx_analytics_sessions_last_seen on analytics_sessions (last_seen);

-- One row per article per session per Kolkata date: how long a reader spent
-- with one article in one visit, plus coarse scroll milestones.
create table if not exists analytics_article_session (
  article_id text not null references articles (id) on delete cascade,
  date text not null,            -- Kolkata calendar date (YYYY-MM-DD)
  session_id text not null,
  page_views integer not null default 0,
  engaged_seconds real not null default 0,   -- visible+active time, seconds
  engaged_sessions integer not null default 0, -- sessions reaching the engaged threshold for this article
  max_scroll integer not null default 0,     -- 0..100, deepest scroll reached
  completed integer not null default 0,      -- 1 when ~90% of the article was read
  primary key (article_id, date, session_id)
);
create index if not exists idx_analytics_article_session_date on analytics_article_session (date);
create index if not exists idx_analytics_article_session_article on analytics_article_session (article_id, date);

-- Internal article-to-article link clicks generated from beacon reports.
create table if not exists analytics_link_clicks (
  from_article_id text not null references articles (id) on delete cascade,
  to_article_id text not null references articles (id) on delete cascade,
  date text not null,            -- Kolkata calendar date (YYYY-MM-DD)
  clicks integer not null default 0,
  primary key (from_article_id, to_article_id, date)
);
create index if not exists idx_analytics_link_clicks_from on analytics_link_clicks (from_article_id, date);

-- Purge guard: keep rollups small. Administrators may run this on demand;
-- it never touches published content.
create table if not exists analytics_retention (
  id integer primary key check (id = 1),
  retain_days integer not null default 90,
  last_purged_at text
);
insert into analytics_retention (id, retain_days) values (1, 90)
  on conflict (id) do nothing;
