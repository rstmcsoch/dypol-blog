import { secretMatches } from "../mcp/auth.ts";

/**
 * Authorisation for the tick endpoint. Pure apart from the keyed comparison, so
 * it is covered by the unit tests; the secret values themselves are Worker
 * secrets and are never logged or returned.
 */
export type TickTrigger = "cron" | "mcp";

/** True when at least one tick secret is configured (the endpoint fails closed). */
export function tickConfigured(env: Record<string, string | undefined>): boolean {
  const cron = (env.CRON_SECRET ?? "").trim();
  const mcp = (env.MCP_TOKEN ?? "").trim();
  return cron.length >= 16 || mcp.length >= 32;
}

/**
 * Which secret authorised this request, or null. CRON_SECRET is checked first,
 * then MCP_TOKEN (which already guards the MCP endpoint) so an existing setup
 * needs no new secret.
 */
export async function tickAuthorised(header: string | null, env: Record<string, string | undefined>): Promise<TickTrigger | null> {
  const match = /^Bearer\s+(\S{1,2048})$/i.exec(header?.trim() ?? "");
  if (!match) return null;
  const presented = match[1] as string;
  const cron = (env.CRON_SECRET ?? "").trim();
  if (cron.length >= 16 && (await secretMatches(presented, cron))) return "cron";
  const mcp = (env.MCP_TOKEN ?? "").trim();
  if (mcp.length >= 32 && (await secretMatches(presented, mcp))) return "mcp";
  return null;
}
