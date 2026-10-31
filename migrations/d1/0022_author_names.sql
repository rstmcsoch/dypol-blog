-- t141: per-automation author names. Additive, nullable.
alter table automation_profiles add column author_name text;
alter table articles add column author_name text;
