import { parseHostList } from "./auth";

/**
 * Owner-allowed extra client hosts: the MCP_OAUTH_REDIRECT_HOSTS var plus the
 * desk's automation setting. A database failure falls back to the var only.
 */
export async function extraClientHosts(env: { MCP_OAUTH_REDIRECT_HOSTS?: string }): Promise<string[]> {
  let fromDesk: string[] = [];
  try {
    const { readAutomationSettings } = await import("@/content/automation.server");
    fromDesk = (await readAutomationSettings()).extraClientHosts;
  } catch {
    fromDesk = [];
  }
  return parseHostList(env.MCP_OAUTH_REDIRECT_HOSTS, fromDesk);
}
