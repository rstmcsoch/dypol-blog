import { getSql } from "../db";
import { authConfigured, getSessionUser, requireUserId, UnauthorizedError } from "./verify.server";

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}

function allowlist(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export type AdminIdentity = { id: string; email: string | null; mode: "dev" | "account" };

/**
 * Server-side desk check.
 * Sign-in off (this workspace default) resolves the shared dev user.
 * Sign-in on requires a session whose email is in ADMIN_EMAILS or admin_grants.
 */
export async function requireAdmin(bearerToken?: string): Promise<AdminIdentity> {
  const userId = await requireUserId(bearerToken);
  if (!authConfigured) return { id: userId, email: null, mode: "dev" };
  const user = await getSessionUser(bearerToken);
  if (!user) throw new UnauthorizedError();
  const email = user.email?.trim().toLowerCase() ?? "";
  const listed = allowlist();
  if (listed.length > 0) {
    if (!email || !listed.includes(email)) throw new ForbiddenError();
    return { id: user.id, email: user.email, mode: "account" };
  }
  const sql = await getSql();
  const grants = await sql<{ email: string }>`select email from admin_grants`;
  if (!email || !grants.some((row) => row.email.toLowerCase() === email)) throw new ForbiddenError();
  return { id: user.id, email: user.email, mode: "account" };
}

export async function listGrants(): Promise<string[]> {
  const sql = await getSql();
  const rows = await sql<{ email: string }>`select email from admin_grants order by email asc`;
  return rows.map((row) => row.email);
}

export async function addGrant(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Enter a valid email.");
  const sql = await getSql();
  await sql`insert into admin_grants (email) values (${normalized}) on conflict (email) do nothing`;
}

export async function removeGrant(email: string): Promise<void> {
  const sql = await getSql();
  await sql`delete from admin_grants where email = ${email.trim().toLowerCase()}`;
}
