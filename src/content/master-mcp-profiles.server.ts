import { getSql } from "@/lib/db";
import {
  hashSecret,
  newMasterConnectionId,
  newMasterToken,
  tokenPrefix,
  type MasterCredentialStatus,
} from "@/lib/mcp/master/credentials";
import { ensureMasterTables } from "./master-mcp.server";

type CredRow = {
  id: string;
  created_at: string;
  name: string;
  token_hash: string | null;
  token_prefix: string;
  status: string;
  last_connected_at: string | null;
  last_activity_at: string | null;
  last_client_name: string | null;
  revoked_at: string | null;
  deactivated_at: string | null;
};

export type MasterProfileView = {
  id: string;
  name: string;
  status: MasterCredentialStatus;
  tokenPrefix: string | null;
  createdAt: string;
  lastConnectedAt: string | null;
  lastActivityAt: string | null;
  lastClientName: string | null;
  revokedAt: string | null;
  deactivatedAt: string | null;
};

function toView(row: CredRow): MasterProfileView {
  const status = (["active", "deactivated", "revoked"] as const).includes(row.status as MasterCredentialStatus)
    ? (row.status as MasterCredentialStatus)
    : "revoked";
  return {
    id: row.id,
    name: row.name || "Master MCP",
    status,
    tokenPrefix: row.token_prefix || null,
    createdAt: row.created_at,
    lastConnectedAt: row.last_connected_at,
    lastActivityAt: row.last_activity_at,
    lastClientName: row.last_client_name,
    revokedAt: row.revoked_at,
    deactivatedAt: row.deactivated_at,
  };
}

export async function listMasterProfiles(): Promise<MasterProfileView[]> {
  await ensureMasterTables();
  const sql = await getSql();
  const rows = await sql<CredRow>`
    select id, created_at, name, token_hash, token_prefix, status,
           last_connected_at, last_activity_at, last_client_name, revoked_at, deactivated_at
    from master_mcp_credentials
    order by created_at desc
    limit 50
  `.catch(() => [] as CredRow[]);
  return rows.map(toView);
}

async function findByIdOrLatest(id?: string): Promise<CredRow | null> {
  await ensureMasterTables();
  const sql = await getSql();
  const target = id?.trim();
  const rows = target
    ? await sql<CredRow>`select id, created_at, name, token_hash, token_prefix, status, last_connected_at, last_activity_at, last_client_name, revoked_at, deactivated_at from master_mcp_credentials where id = ${target} limit 1`.catch(() => [] as CredRow[])
    : await sql<CredRow>`select id, created_at, name, token_hash, token_prefix, status, last_connected_at, last_activity_at, last_client_name, revoked_at, deactivated_at from master_mcp_credentials order by created_at desc limit 1`.catch(() => [] as CredRow[]);
  return rows[0] ?? null;
}

export async function createMasterProfile(name = "Master MCP"): Promise<{ token: string; prefix: string; id: string; name: string }> {
  await ensureMasterTables();
  const id = newMasterConnectionId();
  const token = newMasterToken(id);
  const hash = await hashSecret(token);
  const prefix = tokenPrefix(token);
  const now = new Date().toISOString();
  const label = name.trim().slice(0, 80) || "Master MCP";
  const sql = await getSql();
  await sql`
    insert into master_mcp_credentials (id, created_at, name, token_hash, token_prefix, status, created_by)
    values (${id}, ${now}, ${label}, ${hash}, ${prefix}, 'active', 'admin')
  `;
  return { token, prefix, id, name: label };
}

export async function renameMasterProfile(id: string, name: string): Promise<{ id: string; name: string }> {
  const existing = await findByIdOrLatest(id);
  if (!existing) throw new Error("Master MCP profile not found.");
  const label = name.trim().slice(0, 80);
  if (!label) throw new Error("Profile name cannot be empty.");
  const sql = await getSql();
  await sql`update master_mcp_credentials set name = ${label} where id = ${existing.id}`;
  return { id: existing.id, name: label };
}

export async function rotateMasterProfile(id?: string): Promise<{ token: string; prefix: string; id: string; name: string }> {
  const existing = await findByIdOrLatest(id);
  if (!existing) throw new Error("Master MCP profile not found.");
  if (existing.status === "revoked") throw new Error("Revoked profiles cannot be rotated. Create a new profile instead.");
  const token = newMasterToken(existing.id);
  const hash = await hashSecret(token);
  const prefix = tokenPrefix(token);
  const sql = await getSql();
  await sql`
    update master_mcp_credentials
    set token_hash = ${hash}, token_prefix = ${prefix}, status = 'active',
        revoked_at = null, deactivated_at = null, rotated_from = ${existing.id}
    where id = ${existing.id}
  `;
  return { token, prefix, id: existing.id, name: existing.name };
}

export async function deactivateMasterProfile(id?: string): Promise<void> {
  const existing = await findByIdOrLatest(id);
  if (!existing) throw new Error("Master MCP profile not found.");
  if (existing.status === "revoked") throw new Error("That profile has been revoked.");
  const sql = await getSql();
  const now = new Date().toISOString();
  await sql`update master_mcp_credentials set status = 'deactivated', deactivated_at = ${now} where id = ${existing.id}`;
}

export async function reactivateMasterProfile(id?: string): Promise<void> {
  const existing = await findByIdOrLatest(id);
  if (!existing) throw new Error("Master MCP profile not found.");
  if (existing.status === "revoked") throw new Error("A revoked profile cannot be reactivated. Create a new one.");
  const sql = await getSql();
  await sql`update master_mcp_credentials set status = 'active', deactivated_at = null where id = ${existing.id}`;
}

export async function revokeMasterProfile(id?: string): Promise<void> {
  const existing = await findByIdOrLatest(id);
  if (!existing) throw new Error("Master MCP profile not found.");
  const sql = await getSql();
  const now = new Date().toISOString();
  await sql`update master_mcp_credentials set status = 'revoked', token_hash = null, revoked_at = ${now} where id = ${existing.id}`;
}

export async function deleteMasterProfile(id: string): Promise<void> {
  const existing = await findByIdOrLatest(id);
  if (!existing) throw new Error("Master MCP profile not found.");
  const sql = await getSql();
  await sql`delete from master_mcp_credentials where id = ${existing.id}`;
}
