/**
 * Admin credential store (t80) — D1 tables from migration 0013 (also
 * self-created here, following the 0011/0012 pattern, so a merge never
 * breaks before the migration is applied).
 *
 * State machine that keeps the owner lockout-proof:
 *   no row (or no enabled row)  → ADMIN_TOKEN login works (bootstrap mode)
 *   row with totp_enabled = 1   → username+password+TOTP login; token refused
 * TOTP enrolment goes through totp_pending_enc and only becomes the active
 * secret after the owner proves the authenticator works with a live code.
 * Recovery codes are stored hashed and consumed with a single atomic
 * UPDATE ... WHERE used_at IS NULL, so a code can never be replayed.
 */
import type { Sql } from "@/lib/db";
import {
  decryptTotpSecret, generateRecoveryCodes, generateTotpSecret, hashPassword, hashRecoveryCode,
  looksLikeRecoveryCode, verifyPassword, verifyTotp,
} from "./admin-credentials.ts";

export interface AdminUserRow {
  id: number;
  username: string;
  password_hash: string;
  totp_secret_enc: string | null;
  totp_pending_enc: string | null;
  totp_enabled: number;
  created_at: number;
  updated_at: number;
}

export async function ensureAdminTables(sql: Sql): Promise<void> {
  await sql`create table if not exists admin_users (
    id integer primary key autoincrement,
    username text not null unique,
    password_hash text not null,
    totp_secret_enc text,
    totp_pending_enc text,
    totp_enabled integer not null default 0,
    created_at integer not null,
    updated_at integer not null
  )`;
  await sql`create table if not exists admin_recovery_codes (
    id integer primary key autoincrement,
    user_id integer not null references admin_users(id),
    code_hash text not null,
    used_at integer,
    created_at integer not null
  )`;
  await sql`create index if not exists idx_admin_recovery_user on admin_recovery_codes(user_id)`;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

export async function getEnabledUser(sql: Sql): Promise<AdminUserRow | null> {
  const rows = await sql<AdminUserRow>`select * from admin_users where totp_enabled = 1 order by id limit 1`;
  return rows[0] ?? null;
}
export async function getAnyUser(sql: Sql): Promise<AdminUserRow | null> {
  const rows = await sql<AdminUserRow>`select * from admin_users order by id limit 1`;
  return rows[0] ?? null;
}
export async function getUserById(sql: Sql, id: number): Promise<AdminUserRow | null> {
  const rows = await sql<AdminUserRow>`select * from admin_users where id = ${id} limit 1`;
  return rows[0] ?? null;
}
export async function getUserByUsername(sql: Sql, username: string): Promise<AdminUserRow | null> {
  const rows = await sql<AdminUserRow>`select * from admin_users where username = ${username} limit 1`;
  return rows[0] ?? null;
}

/** Password login is active only once setup has been confirmed with a live TOTP code. */
export async function passwordLoginActive(sql: Sql): Promise<boolean> {
  return (await getEnabledUser(sql)) !== null;
}

let dummyHash: Promise<string> | null = null;
/** Verify against a real-looking hash for unknown usernames (timing equalisation). */
export async function verifyPasswordForUser(user: AdminUserRow | null, password: string): Promise<boolean> {
  if (!user) {
    dummyHash ??= hashPassword("timing-equalisation-dummy");
    await verifyPassword(password, await dummyHash);
    return false;
  }
  return verifyPassword(password, user.password_hash);
}

/**
 * Start (or restart) enrolment: creates the pending user on first setup, or
 * replaces the pending secret for a 2FA reset. Never touches the active
 * secret until confirmTotp() succeeds.
 */
export async function startTotpEnrolment(sql: Sql, keyMaterial: string, opts: { username?: string; password?: string }): Promise<{ user: AdminUserRow; secret: string }> {
  const { encryptTotpSecret } = await import("./admin-credentials.ts");
  const { secret } = generateTotpSecret();
  const secretEnc = await encryptTotpSecret(keyMaterial, secret);
  const now = nowSeconds();
  const existing = await getAnyUser(sql);
  if (!existing) {
    if (!opts.username || !opts.password) throw new Error("Username and password are required.");
    const passwordHash = await hashPassword(opts.password);
    const rows = await sql<{ id: number }>`insert into admin_users (username, password_hash, totp_secret_enc, totp_pending_enc, totp_enabled, created_at, updated_at)
      values (${opts.username}, ${passwordHash}, null, ${secretEnc}, 0, ${now}, ${now}) returning id`;
    const user = await getUserById(sql, Number(rows[0].id));
    return { user: user!, secret };
  }
  await sql`update admin_users set totp_pending_enc = ${secretEnc}, updated_at = ${now} where id = ${existing.id}`;
  const user = await getUserById(sql, existing.id);
  return { user: user!, secret };
}

/** Confirm a pending enrolment with a live code; activates the new secret. */
export type ConfirmResult = "ok" | "no-pending" | "decrypt-failed" | "code-mismatch";

export async function confirmTotp(sql: Sql, keyMaterial: string, user: AdminUserRow, code: string): Promise<ConfirmResult> {
  if (!user.totp_pending_enc) return "no-pending";
  const secret = await decryptTotpSecret(keyMaterial, user.totp_pending_enc);
  if (!secret) return "decrypt-failed";
  if (!(await verifyTotp(secret, code))) return "code-mismatch";
  await sql`update admin_users set totp_secret_enc = totp_pending_enc, totp_pending_enc = null, totp_enabled = 1, updated_at = ${nowSeconds()} where id = ${user.id}`;
  return "ok";
}

export async function replaceRecoveryCodes(sql: Sql, userId: number): Promise<string[]> {
  const codes = generateRecoveryCodes(10);
  await sql`delete from admin_recovery_codes where user_id = ${userId}`;
  const now = nowSeconds();
  for (const code of codes) {
    await sql`insert into admin_recovery_codes (user_id, code_hash, used_at, created_at) values (${userId}, ${await hashRecoveryCode(code)}, null, ${now})`;
  }
  return codes;
}

export async function countUnusedRecoveryCodes(sql: Sql, userId: number): Promise<number> {
  const rows = await sql<{ n: number }>`select count(*) as n from admin_recovery_codes where user_id = ${userId} and used_at is null`;
  return Number(rows[0]?.n ?? 0);
}

/** Single-use: one atomic statement claims the code; replay finds no unused row. */
export async function consumeRecoveryCode(sql: Sql, userId: number, code: string): Promise<boolean> {
  if (!looksLikeRecoveryCode(code)) return false;
  const hash = await hashRecoveryCode(code);
  const rows = await sql<{ id: number }>`update admin_recovery_codes set used_at = ${nowSeconds()} where user_id = ${userId} and code_hash = ${hash} and used_at is null returning id`;
  return rows.length > 0;
}

/**
 * Second-factor check for login and for sensitive Security-page changes.
 * Accepts a TOTP code, or a recovery code (consumed on success). Recovery
 * still works when the TOTP secret can't be decrypted (rotated secrets).
 */
export async function checkSecondFactor(sql: Sql, keyMaterial: string, user: AdminUserRow, code: string): Promise<"totp" | "recovery" | null> {
  const secret = user.totp_secret_enc ? await decryptTotpSecret(keyMaterial, user.totp_secret_enc) : null;
  if (secret && (await verifyTotp(secret, code))) return "totp";
  if (await consumeRecoveryCode(sql, user.id, code)) return "recovery";
  return null;
}

export async function updatePassword(sql: Sql, userId: number, newPassword: string): Promise<void> {
  await sql`update admin_users set password_hash = ${await hashPassword(newPassword)}, updated_at = ${nowSeconds()} where id = ${userId}`;
}
