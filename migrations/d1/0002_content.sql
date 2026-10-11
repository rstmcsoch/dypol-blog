-- Journal content store on D1 (SQLite). Media rows live in 0001_media.sql.
create table if not exists categories (
  id text primary key,
  slug text not null unique,
  label text not null,
  description text not null default ''
);

create table if not exists tags (
  id text primary key,
  slug text not null unique,
  label text not null
);

create table if not exists articles (
  id text primary key,
  slug text not null unique,
  title text not null,
  excerpt text not null default '',
  status text not null check (status in ('draft', 'published', 'unpublished')),
  published_at text,
  updated_at text not null,
  category_id text not null references categories (id),
  motif text not null check (motif in ('corner', 'band', 'split', 'stamp', 'stack', 'edge')),
  featured integer not null default 0,
  seo_title text,
  seo_description text,
  cover_media_id text,
  blocks text not null
);

create table if not exists article_tags (
  article_id text not null references articles (id) on delete cascade,
  tag_id text not null references tags (id),
  primary key (article_id, tag_id)
);

create table if not exists site_settings (
  id text primary key,
  data text not null
);

create table if not exists admin_grants (
  email text primary key
);

create index if not exists articles_status_published_idx on articles (status, published_at);
create index if not exists articles_updated_idx on articles (updated_at);
create index if not exists articles_category_idx on articles (category_id);
