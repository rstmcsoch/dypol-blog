-- Editorial statistics: compact daily aggregates only.
-- No per-visitor rows, no IPs, no cookies, no raw user agents.
-- Safe to apply more than once (all statements are IF NOT EXISTS).

create table if not exists article_daily_stats (
  article_id text not null,
  day text not null,
  views integer not null default 0,
  engaged_views integer not null default 0,
  engaged_ms integer not null default 0,
  scroll_25 integer not null default 0,
  scroll_50 integer not null default 0,
  scroll_75 integer not null default 0,
  scroll_90 integer not null default 0,
  scroll_end integer not null default 0,
  internal_clicks integer not null default 0,
  recirc_views integer not null default 0,
  inbound_internal integer not null default 0,
  b0 integer not null default 0,
  b1 integer not null default 0,
  b2 integer not null default 0,
  b3 integer not null default 0,
  b4 integer not null default 0,
  b5 integer not null default 0,
  b6 integer not null default 0,
  primary key (article_id, day)
);

create index if not exists article_daily_stats_day_idx on article_daily_stats (day);

create table if not exists site_daily_stats (
  day text primary key,
  article_views integer not null default 0,
  other_views integer not null default 0
);

create table if not exists traffic_daily_stats (
  day text not null,
  channel text not null,
  views integer not null default 0,
  engaged_views integer not null default 0,
  engaged_ms integer not null default 0,
  primary key (day, channel)
);

create table if not exists referrer_daily_stats (
  day text not null,
  host text not null,
  views integer not null default 0,
  primary key (day, host)
);

create table if not exists device_daily_stats (
  day text not null,
  device text not null,
  views integer not null default 0,
  engaged_views integer not null default 0,
  engaged_ms integer not null default 0,
  primary key (day, device)
);

create table if not exists geo_daily_stats (
  day text not null,
  country text not null,
  views integer not null default 0,
  engaged_views integer not null default 0,
  engaged_ms integer not null default 0,
  primary key (day, country)
);

create table if not exists region_daily_stats (
  day text not null,
  country text not null,
  region text not null,
  views integer not null default 0,
  primary key (day, country, region)
);

create table if not exists browser_daily_stats (
  day text not null,
  browser text not null,
  views integer not null default 0,
  primary key (day, browser)
);

create table if not exists os_daily_stats (
  day text not null,
  os text not null,
  views integer not null default 0,
  primary key (day, os)
);

create table if not exists campaign_daily_stats (
  day text not null,
  source text not null,
  medium text not null,
  campaign text not null,
  views integer not null default 0,
  primary key (day, source, medium, campaign)
);

create table if not exists stats_meta (
  key text primary key,
  value text not null
);
