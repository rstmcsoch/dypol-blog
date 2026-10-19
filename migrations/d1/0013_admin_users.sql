-- t80: username + password + TOTP admin login. Additive only; code also
-- creates these tables if missing so nothing breaks before this is applied.
-- The ADMIN_TOKEN login keeps working until a row exists with
-- totp_enabled = 1 (i.e. Rustam has completed Security setup); after that
-- the token login is refused. Deleting the admin_users row(s) in the D1
-- console is the documented emergency recovery (token login comes back).
create table if not exists admin_users (
  id integer primary key autoincrement,
  username text not null unique,
  password_hash text not null,
  totp_secret_enc text,
  totp_pending_enc text,
  totp_enabled integer not null default 0,
  created_at integer not null,
  updated_at integer not null
);
create table if not exists admin_recovery_codes (
  id integer primary key autoincrement,
  user_id integer not null references admin_users(id),
  code_hash text not null,
  used_at integer,
  created_at integer not null
);
create index if not exists idx_admin_recovery_user on admin_recovery_codes(user_id);
