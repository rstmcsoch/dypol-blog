-- t115 PR B.
-- Corrections note shown at the end of an article (editable in admin).
alter table articles add column corrections text;

-- Full-text search over published stories (title, excerpt, body, topics).
-- The app keeps it in sync: it rebuilds when the published set changes
-- (signature in search_meta), so every write path is covered.
create virtual table if not exists articles_fts using fts5(
  article_id unindexed, title, excerpt, body, topics,
  tokenize = 'porter unicode61 remove_diacritics 2'
);
create table if not exists search_meta (id text primary key, signature text not null, built_at text not null);

-- Contact form submissions (Turnstile-verified).
create table if not exists contact_messages (
  id text primary key,
  name text not null,
  email text not null,
  message text not null,
  created_at text not null,
  handled integer not null default 0
);
create index if not exists contact_messages_created_idx on contact_messages (created_at);
