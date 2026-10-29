-- Confidential OAuth clients (client id + secret) for MCP connectors that
-- cannot use a bearer API key alone (Gemini custom connectors, and any AI
-- that asks for an OAuth client id, secret, and redirect URL).
-- One client per automation profile, including "default".
-- The secret is stored only as SHA-256. The table is also created on demand.
create table if not exists automation_oauth_clients (
  profile_id text primary key,
  client_id text not null unique,
  secret_hash text not null,
  secret_hint text,
  name text not null,
  redirect_uris text not null,
  created_at text not null,
  updated_at text not null
);
