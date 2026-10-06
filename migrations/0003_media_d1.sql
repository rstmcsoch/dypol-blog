-- Image bytes and the media catalog live on the existing Cloudflare bindings:
--   MEDIA  R2 bucket dypol-blog-media
--   DB     D1 database dypol-blog-db (table media)
-- Postgres keeps references only. Drop the earlier blob table if it was created.

alter table articles add column if not exists cover_media_id text;

drop table if exists media;
