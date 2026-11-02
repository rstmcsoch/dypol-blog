-- t173: Special Articles. Additive only: existing rows keep article_type 'regular'
-- and every existing query keeps working unchanged.
--
-- A special article keeps its normal metadata row in `articles` (title, slug,
-- status, topics, tags, cover, SEO, byline) so search, topics, sitemap and RSS
-- see it. Its long-form body lives in R2 (dypol-blog-media) as immutable,
-- versioned JSON objects; `special_article_state.current_version` points at the
-- live one. `articles.blocks` stays '[]' for specials.
alter table articles add column article_type text not null default 'regular'
  check (article_type in ('regular', 'special'));
create index if not exists articles_type_idx on articles (article_type, status);

-- One row per saved body version (immutable R2 object special-articles/{id}/body/v{n}.json).
create table if not exists special_article_versions (
  article_id text not null,
  version integer not null,
  r2_key text not null,
  sha256 text not null,
  bytes integer not null,
  word_count integer not null default 0,
  created_at text not null,
  created_by text not null default 'admin',
  note text not null default '',
  primary key (article_id, version)
);

-- The live pointer plus derived, never-public data (quality report, search text).
create table if not exists special_article_state (
  article_id text primary key references articles (id) on delete cascade,
  current_version integer not null,
  word_count integer not null default 0,
  search_text text not null default '',
  quality_report text,
  autosave_at text,
  updated_at text not null
);

-- Research notebook for special drafts: sources, attached resources, claims and
-- reports, grouped by a collection key the AI (or the editor) chooses.
create table if not exists special_research (
  id text primary key,
  collection_key text not null,
  profile_id text not null default 'default',
  kind text not null check (kind in ('source', 'resource', 'claim', 'report', 'dataset')),
  data text not null,
  created_at text not null
);
create index if not exists special_research_key_idx on special_research (collection_key, kind);

-- Cloud storage connections (Google Drive, OneDrive, Dropbox, Proton links).
-- Tokens are AES-GCM encrypted with the CLOUD_TOKEN_KEY Worker secret and are
-- never returned to the browser or to AI tools.
create table if not exists cloud_connections (
  provider text primary key check (provider in ('google-drive', 'onedrive', 'dropbox', 'proton-drive')),
  status text not null default 'disconnected',
  account_label text not null default '',
  scopes text not null default '',
  folders text not null default '[]',
  token_ciphertext text,
  token_iv text,
  expires_at text,
  last_test text,
  connected_at text,
  updated_at text not null
);

create table if not exists cloud_oauth_states (
  state text primary key,
  provider text not null,
  verifier text not null,
  created_at text not null
);

-- RSS monitoring dedup for special automation.
create table if not exists special_feed_seen (
  feed_url text not null,
  item_key text not null,
  title text not null default '',
  link text not null default '',
  seen_at text not null,
  primary key (feed_url, item_key)
);
