import type { AutomationMode, AutomationSettings, ServerApiProvider, ServerApiSettings } from "./settings.ts";
import { unsafeUrlReason } from "./image-fetch.ts";

/**
 * Who writes the articles.
 *
 * - "mcp-connector" (active by default): any AI app that supports remote MCP
 *   connectors (Claude, ChatGPT, Grok, Cursor, Claude Code, Gemini CLI, VS Code,
 *   ...) calls this site's MCP tools on a schedule configured in that app. The
 *   site never calls an AI service in this mode.
 * - "server-api": the site itself would call an AI provider's API (xAI, OpenAI,
 *   Anthropic, Google Gemini, OpenRouter or any OpenAI-compatible endpoint)
 *   using a key stored ONLY as a Worker secret. It is active only when the owner
 *   selects it AND the matching key secret exists. This release ships the
 *   adapters (request building + response parsing, tested with a mocked fetch)
 *   but nothing schedules or triggers a run, so no request is ever made.
 */

/** Secret names checked per provider, in order. AI_API_KEY is a generic fallback. */
export const PROVIDER_KEY_SECRETS: Record<ServerApiProvider, readonly string[]> = {
  xai: ["XAI_API_KEY", "AI_API_KEY"],
  openai: ["OPENAI_API_KEY", "AI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY", "AI_API_KEY"],
  gemini: ["GEMINI_API_KEY", "AI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY", "AI_API_KEY"],
  "openai-compatible": ["AI_API_KEY"],
};

export const PROVIDER_LABELS: Record<ServerApiProvider, string> = {
  xai: "xAI (Grok API)",
  openai: "OpenAI",
  anthropic: "Anthropic (Claude API)",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
  "openai-compatible": "OpenAI-compatible (custom base URL)",
};

export const ALL_KEY_SECRETS = ["AI_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"] as const;
export type KeyEnv = Partial<Record<(typeof ALL_KEY_SECRETS)[number], string>>;

const present = (v: unknown) => typeof v === "string" && v.trim().length > 0;

/** Names (never values) of the AI key secrets that are set. */
export function configuredKeyNames(env: KeyEnv): string[] {
  return ALL_KEY_SECRETS.filter((name) => present(env[name]));
}

export function keyFor(provider: ServerApiProvider, env: KeyEnv): { name: string; value: string } | null {
  for (const name of PROVIDER_KEY_SECRETS[provider]) {
    const value = env[name as keyof KeyEnv];
    if (present(value)) return { name, value: (value as string).trim() };
  }
  return null;
}

export type ProviderStatus = {
  mode: AutomationMode;
  active: AutomationMode;
  serverApi: { provider: ServerApiProvider; label: string; model: string; keySecret: string | null; ready: boolean };
  configuredKeys: string[];
  note: string;
};

export function providerStatus(settings: AutomationSettings, env: KeyEnv): ProviderStatus {
  const api = settings.serverApi;
  const key = keyFor(api.provider, env);
  const serverApi = {
    provider: api.provider,
    label: PROVIDER_LABELS[api.provider],
    model: api.model || defaultModel(api.provider),
    keySecret: key?.name ?? null,
    ready: Boolean(key),
  };
  const base = { mode: settings.mode, serverApi, configuredKeys: configuredKeyNames(env) };
  if (settings.mode === "server-api" && key) {
    return {
      ...base,
      active: "server-api",
      note: `server-api is selected with ${serverApi.label} (${key.name} is set). This release has no scheduler, so the site still makes no AI requests; keep using an AI connector.`,
    };
  }
  return {
    ...base,
    active: "mcp-connector",
    note:
      settings.mode === "server-api"
        ? `server-api is selected but no key secret for ${serverApi.label} is set (${PROVIDER_KEY_SECRETS[api.provider].join(" or ")}); the MCP connector stays active.`
        : "Your AI app writes through the MCP connector on its own schedule; the site makes no AI requests.",
  };
}

// ---- server-api adapters (request building / parsing only) ----------------

export const DEFAULT_MODELS: Record<ServerApiProvider, string> = {
  xai: "grok-4",
  openai: "gpt-5",
  anthropic: "claude-sonnet-4-5",
  gemini: "gemini-2.5-pro",
  openrouter: "openrouter/auto",
  "openai-compatible": "",
};

export function defaultModel(provider: ServerApiProvider): string {
  return DEFAULT_MODELS[provider];
}

const OPENAI_STYLE_BASE: Partial<Record<ServerApiProvider, string>> = {
  xai: "https://api.x.ai/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

export type GenerateInput = { system: string; prompt: string; maxTokens?: number };
export type BuiltRequest = { url: string; init: { method: "POST"; headers: Record<string, string>; body: string } };

export class ProviderError extends Error {}

export function buildRequest(api: ServerApiSettings, apiKey: string, input: GenerateInput): BuiltRequest {
  const model = api.model || defaultModel(api.provider);
  if (!model) throw new ProviderError("A model id is required for this provider.");
  const maxTokens = Math.min(Math.max(input.maxTokens ?? 4000, 256), 16000);
  const json = (headers: Record<string, string>, url: string, body: unknown): BuiltRequest => ({
    url,
    init: { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) },
  });
  switch (api.provider) {
    case "anthropic":
      return json({ "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, "https://api.anthropic.com/v1/messages", {
        model,
        max_tokens: maxTokens,
        system: input.system,
        messages: [{ role: "user", content: input.prompt }],
      });
    case "gemini":
      return json(
        { "x-goog-api-key": apiKey },
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: "user", parts: [{ text: input.prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens },
        },
      );
    default: {
      let base = OPENAI_STYLE_BASE[api.provider];
      if (api.provider === "openai-compatible") {
        const problem = unsafeUrlReason(api.baseUrl);
        if (problem) throw new ProviderError(`Base URL rejected: ${problem}`);
        base = api.baseUrl;
      }
      return json({ authorization: `Bearer ${apiKey}` }, `${(base as string).replace(/\/+$/, "")}/chat/completions`, {
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.prompt },
        ],
      });
    }
  }
}

export function parseResponse(provider: ServerApiProvider, data: unknown): string {
  const d = data as Record<string, any>;
  let text: unknown;
  if (provider === "anthropic") {
    text = Array.isArray(d?.content) ? d.content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("") : undefined;
  } else if (provider === "gemini") {
    text = d?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("");
  } else {
    text = d?.choices?.[0]?.message?.content;
  }
  if (typeof text !== "string" || !text.trim()) throw new ProviderError("The provider returned no text.");
  return text;
}

/**
 * One generation call. Refuses unless mode is server-api AND a key secret is set.
 * Nothing in this release calls it outside tests (no scheduler).
 */
export async function generateWithServerApi(
  settings: AutomationSettings,
  env: KeyEnv,
  input: GenerateInput,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (settings.mode !== "server-api") throw new ProviderError("server-api mode is not selected. No request was made.");
  const key = keyFor(settings.serverApi.provider, env);
  if (!key) throw new ProviderError("No API key secret is configured for this provider. No request was made.");
  const { url, init } = buildRequest(settings.serverApi, key.value, input);
  const res = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new ProviderError(`The provider answered ${res.status}.`);
  return parseResponse(settings.serverApi.provider, await res.json());
}
