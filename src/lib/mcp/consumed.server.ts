import { getSql } from "@/lib/db";

/**
 * t79 (SEC-001): D1-backed single-use claims for OAuth code/refresh nonces.
 * Stores only SHA-256 hashes of nonces. Table comes from migration 0012;
 * it is also created here if missing so the app never breaks pre-migration.
 */
let ready = false;

async function ensure(): Promise<void> {
  if (ready) return;
  const sql = await getSql();
  await sql`create table if not exists oauth_consumed (kind text not null, nonce_hash text not null, expires_at integer not null, primary key (kind, nonce_hash))`;
  ready = true;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Returns true exactly once per (kind, nonce): the first claim wins. */
export async function claimOAuthNonce(kind: "code" | "refresh", nonce: string): Promise<boolean> {
  await ensure();
  const sql = await getSql();
  const hash = await sha256Hex(`${kind}:${nonce}`);
  const now = Math.floor(Date.now() / 1000);
  const inserted = await sql<{ n: number }>`insert into oauth_consumed (kind, nonce_hash, expires_at) values (${kind}, ${hash}, ${now + 31 * 24 * 3600}) on conflict (kind, nonce_hash) do nothing returning 1 as n`.catch(() => [] as Array<{ n: number }>);
  if (inserted.length === 0) {
    // Fallback for executors without RETURNING: a conflicting insert throws.
    try {
      await sql`insert into oauth_consumed (kind, nonce_hash, expires_at) values (${kind}, ${hash}, ${now + 31 * 24 * 3600})`;
      return true;
    } catch {
      return false;
    }
  }
  await sql`delete from oauth_consumed where expires_at < ${now}`.catch(() => undefined);
  return true;
}
