-- t115: old slug -> canonical slug, answered with a 301 by /articles/$slug.
-- Filled when an editor renames a published slug and when duplicates are merged.
create table if not exists redirects (
  from_slug text primary key,
  to_slug text not null,
  created_at text not null
);
create index if not exists redirects_to_idx on redirects (to_slug);
