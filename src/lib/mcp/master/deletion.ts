/**
 * Two-stage destructive confirmations for the Master MCP.
 * A preview is issued first; the mutating tool then requires a confirmation
 * token bound to that exact action, resource and preview, with a short TTL.
 * Pure helpers: persistence is the server's job.
 */
export const CONFIRMATION_TTL_MS = 15 * 60 * 1000;

export type ConfirmationAction = "delete_article" | "bulk_delete_articles" | "delete_page" | "delete_media" | "delete_message" | "delete_event";

export type ConfirmationPreview = {
  action: ConfirmationAction;
  resourceId: string;
  /** Canonical payload the confirmation was issued for (stable JSON). */
  preview: unknown;
  issuedAt: string;
  expiresAt: string;
};

export function newConfirmationToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return `cnf_${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function confirmationExpiresAt(now = Date.now(), ttlMs = CONFIRMATION_TTL_MS): string {
  return new Date(now + ttlMs).toISOString();
}

export function confirmationValid(input: {
  stored: { action: string; resourceId: string; expiresAt: string };
  action: string;
  resourceId: string;
  now?: number;
}): { ok: true } | { ok: false; error: string } {
  if (input.stored.action !== input.action) {
    return { ok: false, error: "That confirmation token was issued for a different action. Request a new deletion preview." };
  }
  if (input.stored.resourceId !== input.resourceId) {
    return { ok: false, error: "That confirmation token was issued for a different item. Request a new deletion preview for this item." };
  }
  const exp = Date.parse(input.stored.expiresAt);
  if (Number.isNaN(exp) || (input.now ?? Date.now()) > exp) {
    return { ok: false, error: "That confirmation token has expired. Request a new deletion preview and confirm again." };
  }
  return { ok: true };
}

export function stablePreview(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) out[key] = sortValue((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}
