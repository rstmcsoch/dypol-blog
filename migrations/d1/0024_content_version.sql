-- t147: one-row counter bumped on every content write; public read caches check it.
create table if not exists content_version (id integer primary key, v integer not null default 0);
insert or ignore into content_version (id, v) values (1, 0);
