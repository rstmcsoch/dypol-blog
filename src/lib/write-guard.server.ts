import { getRequest } from "@tanstack/react-start/server";
import { workerEnv } from "./cf-env.server";
import { sameOriginRequest, writesAllowedFor } from "./write-policy.ts";

export { isVersionPreviewHost, sameOriginRequest, writesAllowedFor } from "./write-policy.ts";

/**
 * Decides whether this request may write to D1/R2.
 *
 * - `wrangler preview` deployments run with DYPOL_ENV=preview and their own
 *   preview D1/R2 (see wrangler.jsonc "previews"), so writes are safe there.
 * - A version-preview URL of the production Worker
 *   (`<8 hex>-<worker>.<sub>.workers.dev`) shares production bindings, so it is
 *   read-only: no seeding, no admin writes.
 * - Set DYPOL_WRITES=off on any environment to force read-only.
 */
function requestHost(): string {
  try {
    const request = getRequest();
    return request ? new URL(request.url).host : "";
  } catch {
    return "";
  }
}

export async function writesAllowed(): Promise<boolean> {
  const env = (await workerEnv()) as { DYPOL_ENV?: string; DYPOL_WRITES?: string };
  return writesAllowedFor({ env: env.DYPOL_ENV, writes: env.DYPOL_WRITES, host: requestHost() });
}

export class ReadOnlyError extends Error {
  readonly status = 403;
  constructor() {
    super("This deployment is read-only. Edits are disabled here.");
    this.name = "ReadOnlyError";
  }
}

export function assertSameOrigin(): void {
  const request = getRequest();
  if (request && !sameOriginRequest(request)) throw new Error("Forbidden");
}
