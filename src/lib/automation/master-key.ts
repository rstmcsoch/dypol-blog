/**
 * The Default profile's bearer. Until an admin replaces it, the Cloudflare
 * MCP_TOKEN secret is that bearer. After New API key or Revoke, the secret
 * no longer works as a bearer (OAuth signing still uses it). Only a SHA-256
 * of a desk-issued key is stored. Pure helpers (tested).
 */
export type MasterKeyState = {
  /** Admin has replaced or revoked the Cloudflare secret as a bearer. */
  superseded: boolean;
  /** SHA-256 of the desk-issued key, or null when revoked / never issued. */
  hash: string | null;
};

export function newMasterToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Whether a presented bearer may act as the Default profile.
 * `envMatched` is the constant-time compare against MCP_TOKEN.
 * `deskMatched` is the constant-time compare against the stored hash.
 */
export function masterBearerAllowed(envMatched: boolean, deskMatched: boolean, state: MasterKeyState): boolean {
  if (state.superseded) return Boolean(state.hash) && deskMatched;
  return envMatched || (Boolean(state.hash) && deskMatched);
}
