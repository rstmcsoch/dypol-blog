import type { AiProvider, AutomationSettings } from "./settings.ts";

/**
 * Who writes the articles.
 *
 * - "grok-mcp" (active): Grok, running a Grok Automation on the owner's account,
 *   calls this site's MCP endpoint. The site never calls an AI service; the
 *   schedule, research and writing all happen in Grok.
 * - "xai-api" (future, inactive): the site itself would call the xAI API. It is
 *   only selectable when an XAI_API_KEY secret exists AND the owner chose it, and
 *   even then this release has no client: no request is ever made.
 */
export type ProviderStatus = {
  selected: AiProvider;
  active: AiProvider;
  xaiKeyConfigured: boolean;
  note: string;
};

export function providerStatus(settings: AutomationSettings, env: { XAI_API_KEY?: string }): ProviderStatus {
  const xaiKeyConfigured = Boolean((env.XAI_API_KEY ?? "").trim());
  if (settings.provider === "xai-api" && xaiKeyConfigured) {
    return {
      selected: "xai-api",
      active: "xai-api",
      xaiKeyConfigured,
      note: "xai-api is selected and a key exists, but this release ships no xAI client, so nothing runs. Use grok-mcp.",
    };
  }
  return {
    selected: settings.provider,
    active: "grok-mcp",
    xaiKeyConfigured,
    note:
      settings.provider === "xai-api"
        ? "xai-api is selected but no XAI_API_KEY secret is configured; grok-mcp stays active."
        : "Grok writes through the MCP connector; the site makes no AI requests.",
  };
}

/** The future xAI provider. Deliberately inert: it never performs a network request. */
export async function runXaiProvider(): Promise<never> {
  throw new Error("The xai-api provider is not implemented in this release. No request was made.");
}
