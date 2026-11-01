-- t169: rotating author names per automation profile.
-- One row per profile ('default' = master MCP token profile). `names` is a
-- JSON array in admin order; `next_index` is the slot the NEXT published
-- article gets. Assignment is one atomic UPDATE ... RETURNING, so two
-- concurrent publishes never get the same slot.
create table if not exists automation_authors (
  profile_id text primary key,
  names text not null default '[]',
  next_index integer not null default 0,
  updated_at text not null default ''
);

-- Seed each profile's existing single author name as the first list entry.
insert or ignore into automation_authors (profile_id, names, next_index, updated_at)
  select id, json_array(trim(author_name)), 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from automation_profiles
  where trim(coalesce(author_name, '')) <> '';

insert or ignore into automation_authors (profile_id, names, next_index, updated_at)
  select 'default', json_array(trim(json_extract(data, '$'))), 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from site_settings
  where id = 'automation_default_author' and trim(coalesce(json_extract(data, '$'), '')) <> '';
