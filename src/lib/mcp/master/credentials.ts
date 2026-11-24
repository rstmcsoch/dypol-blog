/**
 * Master MCP bearer credentials: `dypm_m<8 hex>_<48 hex>`.
 * Only a SHA-256 hash is stored; the secret is shown to the owner once.
 * Pure helpers (tested). Distinct from publishing profile tokens (`dyp_p…`).
 */
import { MASTER_RESERVED_ID } from "./permissions.ts";

export const MASTER_TOKEN_PREFIX = "dypm_";
export const MASTER_ID_RE = /^m[0-9a-f]{8}$/;
export const MASTER_TOKEN_RE = /^dypm_(m[0-9a-f]{8})_([0-9a-f]{48})$/;

export type MasterCredentialStatus = "active" | "deactivated" | "revoked";

export function newMasterConnectionId(): string {
  const b = crypto.getRandomValues(new Uint8Array(4));
  return `m${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function newMasterToken(connectionId: string): string {
  if (!MASTER_ID_RE.test(connectionId)) throw new Error("Invalid Master MCP connection id.");
  const b = crypto.getRandomValues(new Uint8Array(24));
  return `dypm_${connectionId}_${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function parseMasterToken(token: string): { connectionId: string } | null {
  const m = MASTER_TOKEN_RE.exec(token.trim());
  return m ? { connectionId: m[1] } : null;
}

export function isMasterTokenShape(token: string): boolean {
  return parseMasterToken(token) !== null;
}

export async function hashSecret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.trim()));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function secretVersion(hash: string): string {
  return hash.slice(0, 12);
}

/** Non-secret prefix shown in the desk after the full token is no longer available. */
export function tokenPrefix(token: string): string {
  const parsed = parseMasterToken(token);
  if (!parsed) return "dypm_…";
  return `dypm_${parsed.connectionId}_…`;
}

export function canAuthenticate(status: MasterCredentialStatus | string | null | undefined): boolean {
  return status === "active";
}

export { MASTER_RESERVED_ID };
