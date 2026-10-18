-- t60: image pipeline variants. Additive only: legacy rows keep working
-- (object_key/byte_size/mime describe the original upload; the /media
-- route falls back to them when hero_key is null). New uploads store
-- media/<id>/hero.webp + media/<id>/thumb.webp in R2 and record both
-- variants here so storage accounting includes variants.
alter table media add column hero_key text;
alter table media add column thumb_key text;
alter table media add column hero_byte_size integer not null default 0;
alter table media add column thumb_byte_size integer not null default 0;
alter table media add column width integer not null default 0;
alter table media add column height integer not null default 0;
alter table media add column processing text not null default 'legacy';
create index if not exists idx_media_processing on media (processing);
