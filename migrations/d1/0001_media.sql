-- Media metadata for the existing D1 database (DB binding, dypol-blog-db).
-- The file bytes live in the MEDIA R2 bucket, not in this table.

create table if not exists media (
  id text primary key,
  object_key text not null unique,
  filename text not null,
  mime text not null,
  alt text not null default '',
  byte_size integer not null,
  created_at text not null
);
