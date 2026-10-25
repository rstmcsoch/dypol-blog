-- t116 PR 2: entry/exit timing, site search terms, chart annotations.
alter table analytics_article_session add column first_at text;
alter table analytics_article_session add column last_at text;

create table if not exists analytics_search_terms (
  term text not null,
  date text not null,
  count integer not null default 0,
  results integer not null default 0,
  primary key (term, date)
);

create table if not exists analytics_annotations (
  id text primary key,
  date text not null,
  note text not null,
  created_at text not null
);
create index if not exists analytics_annotations_date_idx on analytics_annotations (date);
