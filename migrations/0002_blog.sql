create table if not exists categories (
  id text primary key,
  slug text not null unique,
  label text not null,
  description text not null
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
  excerpt text not null,
  status text not null check (status in ('draft','published','unpublished')),
  published_at timestamptz,
  updated_at timestamptz not null,
  category_id text not null references categories(id),
  motif text not null check (motif in ('corner','band','split','stamp','stack','edge')),
  featured boolean not null default false,
  seo_title text,
  seo_description text,
  blocks jsonb not null
);

create table if not exists article_tags (
  article_id text not null references articles(id) on delete cascade,
  tag_id text not null references tags(id) on delete cascade,
  primary key (article_id, tag_id)
);

create index if not exists articles_status_published_idx
  on articles(status, published_at desc);

create index if not exists articles_category_idx
  on articles(category_id);
