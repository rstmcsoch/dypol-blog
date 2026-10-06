-- Canonical journal store: articles, taxonomy, site configuration, and media.
-- Applied once by the existing migrator (Neon on deploy, PGLite in preview).

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
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  category_id text not null references categories (id),
  motif text not null check (motif in ('corner', 'band', 'split', 'stamp', 'stack', 'edge')),
  featured boolean not null default false,
  seo_title text,
  seo_description text,
  cover_media_id text,
  blocks jsonb not null
);

create table if not exists article_tags (
  article_id text not null references articles (id) on delete cascade,
  tag_id text not null references tags (id),
  primary key (article_id, tag_id)
);

create table if not exists site_settings (
  id text primary key,
  data jsonb not null
);

create table if not exists media (
  id text primary key,
  filename text not null,
  mime text not null,
  alt text not null default '',
  bytes bytea not null,
  created_at timestamptz not null default now()
);

create table if not exists admin_grants (
  email text primary key
);

create index if not exists articles_status_idx on articles (status);
create index if not exists articles_updated_idx on articles (updated_at desc);
