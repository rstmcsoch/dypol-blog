-- t79 (SEC-001/SEC-005): single-use OAuth codes + refresh rotation, and
-- server-side admin session revocation. Additive only; code also creates
-- these tables if missing so nothing breaks before this is applied.
create table if not exists oauth_consumed (
  kind text not null,
  nonce_hash text not null,
  expires_at integer not null,
  primary key (kind, nonce_hash)
);
create table if not exists revoked_sessions (
  nonce_hash text primary key,
  expires_at integer not null
);
