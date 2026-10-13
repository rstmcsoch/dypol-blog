import { CREDENTIAL_REFS, type CredentialRef } from "./automation.ts";

/**
 * Credential handling for automations.
 *
 * Rule: the desk and the database only ever store the **name of a Worker
 * secret**. Key material lives in Cloudflare (Workers → Settings → Variables
 * and secrets, type Secret), is read through the Worker bindings, and is never
 * returned to a browser, written to D1, or written to a log line.
 *
 * Isolation: `resolveCredential` matches the automation's own reference and
 * nothing else. There is no "fall back to whatever key is present" path, so one
 * automation can never spend another automation's key by accident.
 */

export type CredentialEnv = Partial<Record<string, string>>;

export type CredentialStatus = {
  name: CredentialRef;
  configured: boolean;
  /** Stable, non-reversible id of the value, so the owner can tell keys apart. */
  fingerprint: string | null;
  /** Character length only — never the value itself. */
  length: number | null;
};

function valueOf(env: CredentialEnv, name: string): string | null {
  const raw = env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Short, non-reversible fingerprint (SHA-256 prefix) of a secret value. */
export async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest).slice(0, 4), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function credentialStatus(env: CredentialEnv): Promise<CredentialStatus[]> {
  const out: CredentialStatus[] = [];
  for (const name of CREDENTIAL_REFS) {
    const value = valueOf(env, name);
    out.push({
      name,
      configured: value !== null,
      fingerprint: value ? await fingerprint(value) : null,
      length: value ? value.length : null,
    });
  }
  return out;
}

/**
 * The secret this automation may use: its own reference, exactly.
 * Returns null when the reference is empty or the secret is not set.
 */
export function resolveCredential(ref: string, env: CredentialEnv): { name: CredentialRef; value: string } | null {
  if (!ref) return null;
  if (!(CREDENTIAL_REFS as readonly string[]).includes(ref)) return null;
  const value = valueOf(env, ref);
  return value ? { name: ref as CredentialRef, value } : null;
}

export function credentialSummary(ref: string, status: CredentialStatus[]): string {
  if (!ref) return "No credential selected (MCP connector mode needs none)";
  const found = status.find((item) => item.name === ref);
  if (!found) return `${ref} is not a supported secret name`;
  if (!found.configured) return `${ref} is not set on this deployment yet`;
  return `${ref} is set (fingerprint ${found.fingerprint}, ${found.length} characters)`;
}

/** Secret names an operator may add, for the desk help text and docs. */
export const DOCUMENTED_SECRETS = [
  "ADMIN_TOKEN",
  "ADMIN_SESSION_SECRET",
  "MCP_TOKEN",
  "CRON_SECRET",
  ...CREDENTIAL_REFS,
] as const;
