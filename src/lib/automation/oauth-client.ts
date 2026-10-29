/**
 * Confidential OAuth clients issued from the desk (client id + secret).
 * Pure helpers: no database. The secret is shown once; only its SHA-256 is stored.
 *
 * These sit beside profile API keys. Dynamic registration (public clients, no
 * secret) is unchanged. An admin pastes the exact redirect URL an AI app shows
 * (Gemini's "Copy redirect URL", or any other connector).
 */
import { adminRegisteredRedirectOk } from "../mcp/auth.ts";

export const OAUTH_CLIENT_ID_RE = /^dypc_[0-9a-f]{32}$/;

export function newOauthClientId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return `dypc_${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function newOauthClientSecret(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return `dyps_${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** 1–5 distinct redirect URLs, each one an exact callback the AI app gave us. */
export function parseAdminRedirects(input: unknown): string[] {
  const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(/\r?\n/) : null;
  if (!list) throw new Error("Paste the redirect URL from the AI app.");
  const uris: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const uri = item.trim();
    if (!uri || uris.includes(uri)) continue;
    uris.push(uri);
  }
  if (uris.length < 1 || uris.length > 5) throw new Error("Paste 1 to 5 redirect URLs, one per line.");
  for (const uri of uris) {
    if (!adminRegisteredRedirectOk(uri)) {
      throw new Error("That redirect URL is not allowed. Paste the exact https URL from the AI app (Gemini: Copy redirect URL). http is only allowed for loopback (localhost / 127.0.0.1).");
    }
  }
  return uris;
}
