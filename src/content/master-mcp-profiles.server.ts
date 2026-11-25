import { getSql } from "@/lib/db";
import {
  hashSecret,
  newMasterConnectionId,
  newMasterToken,
  secretVersion,
  tokenPrefix,
  type MasterCredentialStatus,
} from "@/lib/mcp/master/credentials";
import { ensureMasterTables } from "./master-mcp.server";

export type MasterAuthMethod = "api_key" | "oauth";

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

type OauthRow = {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  redirect_uris: string;
  secret_hint: string;
  status: string;
  revoked_at: string | null;
};

export type MasterProfileView = {
  id: string;
  name: string;
  authMethod: MasterAuthMethod;
  status: MasterCredentialStatus;
  tokenPrefix: string | null;
  clientId?: string | null;
  secretHint?: string | null;
  redirectUris?: string[];
  createdAt: string;
  lastConnectedAt: string | null;
  lastActivityAt: string | null;
  lastClientName: string | null;
  revokedAt: string | null;
  deactivatedAt: string | null;
};

export type CreatedMasterProfile =
  | {
      id: string;
      name: string;
      authMethod: "api_key";
      token: string;
      prefix: string;
    }
  | {
      id: string;
      name: string;
      authMethod: "oauth";
      clientId: string;
      clientSecret: string;
      secretHint: string;
      redirectUris: string[];
    };

function normalizeStatus(raw: string): MasterCredentialStatus {
  if (raw === "active" || raw === "deactivated" || raw === "revoked") return raw;
  return "revoked";
}

function credToView(row: CredRow): MasterProfileView {
  return {
    id: row.id,
    name: row.name || "Master MCP",
    authMethod: "api_key",
    status: normalizeStatus(row.status),
    tokenPrefix: row.token_prefix || null,
    createdAt: row.created_at,
    lastConnectedAt: row.last_connected_at,
    lastActivityAt: row.last_activity_at,
    lastClientName: row.last_client_name,
    revokedAt: row.revoked_at,
    deactivatedAt: row.deactivated_at,
  };
}

function oauthToView(row: OauthRow): MasterProfileView {
  let redirectUris: string[] = [];
  try {
    const parsed = JSON.parse(row.redirect_uris);
    if (Array.isArray(parsed)) redirectUris = parsed.filter((u): u is string => typeof u === "string");
  } catch {
    redirectUris = [];
  }
  return {
    id: row.id,
    name: row.name || "Master MCP OAuth",
    authMethod: "oauth",
    status: normalizeStatus(row.status),
    tokenPrefix: null,
    clientId: row.id,
    secretHint: row.secret_hint || null,
    redirectUris,
    createdAt: row.created_at,
    lastConnectedAt: null,
    lastActivityAt: row.updated_at || null,
    lastClientName: null,
    revokedAt: row.revoked_at,
    deactivatedAt: null,
  };
}

export async function listMasterProfiles(): Promise<MasterProfileView[]> {
  await ensureMasterTables();
  const sql = await getSql();
  const [credRows, oauthRows] = await Promise.all([
    sql<CredRow>`
      select id, created_at, name, token_hash, token_prefix, status,
             last_connected_at, last_activity_at, last_client_name, revoked_at, deactivated_at
      from master_mcp_credentials
      order by created_at desc
      limit 50
    `.catch(() => [] as CredRow[]),
    sql<OauthRow>`
      select id, created_at, updated_at, name, redirect_uris, secret_hint, status, revoked_at
      from master_mcp_oauth_clients
      order by created_at desc
      limit 50
    `.catch(() => [] as OauthRow[]),
  ]);
  return [...credRows.map(credToView), ...oauthRows.map(oauthToView)].sort((a, b) =>
    (b.createdAt || "").localeCompare(a.createdAt || ""),
  );
}

function isOauthId(id: string): boolean {
  return id.startsWith("dypc_");
}

function requireProfileName(name?: string): string {
  const label = (name ?? "").trim().slice(0, 80);
  if (!label) throw new Error("Profile name is required.");
  return label;
}

export async function createMasterProfile(
  input: string | { name?: string; authMethod?: MasterAuthMethod; redirectUris?: string[] },
): Promise<CreatedMasterProfile> {
  await ensureMasterTables();
  const opts = typeof input === "string" ? { name: input, authMethod: "api_key" as const } : input;
  const label = requireProfileName(opts.name);
  const authMethod: MasterAuthMethod = opts.authMethod === "oauth" ? "oauth" : "api_key";
  const now = new Date().toISOString();
  const sql = await getSql();

  if (authMethod === "oauth") {
    const { newOauthClientId, newOauthClientSecret } = await import("@/lib/automation/oauth-client");
    const clientId = newOauthClientId();
    const clientSecret = newOauthClientSecret();
    const hash = await hashSecret(clientSecret);
    const hint = `${clientSecret.slice(0, 8)}…`;
    const version = secretVersion(hash);
    const redirectUris = Array.isArray(opts.redirectUris) ? opts.redirectUris : [];
    await sql`
      insert into master_mcp_oauth_clients (id, created_at, updated_at, name, redirect_uris, secret_hash, secret_hint, secret_version, status)
      values (${clientId}, ${now}, ${now}, ${label}, ${JSON.stringify(redirectUris)}, ${hash}, ${hint}, ${version}, 'active')
    `;
    return { id: clientId, name: label, authMethod: "oauth", clientId, clientSecret, secretHint: hint, redirectUris };
  }

  const id = newMasterConnectionId();
  const token = newMasterToken(id);
  const hash = await hashSecret(token);
  const prefix = tokenPrefix(token);
  await sql`
    insert into master_mcp_credentials (id, created_at, name, token_hash, token_prefix, status, created_by)
    values (${id}, ${now}, ${label}, ${hash}, ${prefix}, 'active', 'admin')
  `;
  return { id, name: label, authMethod: "api_key", token, prefix };
}

export async function renameMasterProfile(id: string, name: string): Promise<{ id: string; name: string }> {
  await ensureMasterTables();
  const label = requireProfileName(name);
  const sql = await getSql();
  if (isOauthId(id)) {
    const now = new Date().toISOString();
    await sql`update master_mcp_oauth_clients set name = ${label}, updated_at = ${now} where id = ${id}`;
    return { id, name: label };
  }
  await sql`update master_mcp_credentials set name = ${label} where id = ${id}`;
  return { id, name: label };
}

export async function rotateMasterProfile(id: string): Promise<CreatedMasterProfile> {
  await ensureMasterTables();
  const sql = await getSql();
  const now = new Date().toISOString();
  if (isOauthId(id)) {
    const rows = await sql<OauthRow>`select id, created_at, updated_at, name, redirect_uris, secret_hint, status, revoked_at from master_mcp_oauth_clients where id = ${id} limit 1`.catch(() => [] as OauthRow[]);
    const existing = rows[0];
    if (!existing) throw new Error("Master MCP profile not found.");
    if (existing.status === "revoked") throw new Error("Revoked profiles cannot be rotated. Create a new profile instead.");
    const { newOauthClientSecret } = await import("@/lib/automation/oauth-client");
    const clientSecret = newOauthClientSecret();
    const hash = await hashSecret(clientSecret);
    const hint = `${clientSecret.slice(0, 8)}…`;
    const version = secretVersion(hash);
    await sql`
      update master_mcp_oauth_clients
      set secret_hash = ${hash}, secret_hint = ${hint}, secret_version = ${version}, status = 'active', revoked_at = null, updated_at = ${now}
      where id = ${existing.id}
    `;
    let redirectUris: string[] = [];
    try { redirectUris = JSON.parse(existing.redirect_uris) as string[]; } catch { redirectUris = []; }
    return { id: existing.id, name: existing.name, authMethod: "oauth", clientId: existing.id, clientSecret, secretHint: hint, redirectUris };
  }

  const rows = await sql<CredRow>`select id, created_at, name, token_hash, token_prefix, status, last_connected_at, last_activity_at, last_client_name, revoked_at, deactivated_at from master_mcp_credentials where id = ${id} limit 1`.catch(() => [] as CredRow[]);
  const existing = rows[0];
  if (!existing) throw new Error("Master MCP profile not found.");
  if (existing.status === "revoked") throw new Error("Revoked profiles cannot be rotated. Create a new profile instead.");
  const token = newMasterToken(existing.id);
  const hash = await hashSecret(token);
  const prefix = tokenPrefix(token);
  await sql`
    update master_mcp_credentials
    set token_hash = ${hash}, token_prefix = ${prefix}, status = 'active',
        revoked_at = null, deactivated_at = null, rotated_from = ${existing.id}
    where id = ${existing.id}
  `;
  return { id: existing.id, name: existing.name, authMethod: "api_key", token, prefix };
}

export async function deactivateMasterProfile(id: string): Promise<void> {
  await ensureMasterTables();
  const sql = await getSql();
  const now = new Date().toISOString();
  if (isOauthId(id)) {
    await sql`update master_mcp_oauth_clients set status = 'deactivated', updated_at = ${now} where id = ${id} and status != 'revoked'`;
    return;
  }
  await sql`update master_mcp_credentials set status = 'deactivated', deactivated_at = ${now} where id = ${id} and status != 'revoked'`;
}

export async function reactivateMasterProfile(id: string): Promise<void> {
  await ensureMasterTables();
  const sql = await getSql();
  const now = new Date().toISOString();
  if (isOauthId(id)) {
    await sql`update master_mcp_oauth_clients set status = 'active', updated_at = ${now} where id = ${id} and status = 'deactivated'`;
    return;
  }
  await sql`update master_mcp_credentials set status = 'active', deactivated_at = null where id = ${id} and status = 'deactivated'`;
}

export async function revokeMasterProfile(id: string): Promise<void> {
  await ensureMasterTables();
  const sql = await getSql();
  const now = new Date().toISOString();
  if (isOauthId(id)) {
    await sql`update master_mcp_oauth_clients set status = 'revoked', revoked_at = ${now}, updated_at = ${now} where id = ${id}`;
    return;
  }
  await sql`update master_mcp_credentials set status = 'revoked', token_hash = null, revoked_at = ${now} where id = ${id}`;
}

export async function deleteMasterProfile(id: string): Promise<void> {
  await ensureMasterTables();
  const sql = await getSql();
  if (isOauthId(id)) {
    await sql`delete from master_mcp_oauth_clients where id = ${id}`;
    return;
  }
  await sql`delete from master_mcp_credentials where id = ${id}`;
}
