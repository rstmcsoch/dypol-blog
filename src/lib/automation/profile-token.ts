/**
 * Per-profile MCP tokens: `dyp_<profileId>_<48 hex>`. Only a SHA-256 hash is
 * stored; the token is shown to the owner once. Pure helpers (tested).
 */
export const PROFILE_ID_RE = /^p[0-9a-f]{8}$/;

export function newProfileId(): string {
  const b = crypto.getRandomValues(new Uint8Array(4));
  return `p${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function newProfileToken(profileId: string): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return `dyp_${profileId}_${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function parseProfileToken(token: string): { profileId: string } | null {
  const m = /^dyp_(p[0-9a-f]{8})_([0-9a-f]{48})$/.exec(token.trim());
  return m ? { profileId: m[1] } : null;
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token.trim()));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Short, non-secret fingerprint of the current token; bound into OAuth tokens. */
export function tokenVersion(hash: string): string {
  return hash.slice(0, 12);
}
