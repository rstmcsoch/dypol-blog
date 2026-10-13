import type { AutomationMode, AutomationSettings, ServerApiProvider, ServerApiSettings } from "./settings.ts";
import { defaultModel } from "./settings.ts";
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

export { DEFAULT_MODELS, defaultModel } from "./settings.ts";

const OPENAI_STYLE_BASE: Partial<Record<ServerApiProvider, string>> = {
  xai: "https://api.x.ai/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

export type GenerateInput = { system: string; prompt: string; maxTokens?: number };
export type BuiltRequest = { url: string; init: { method: "POST"; headers: Record<string, string>; body: string } };

export class ProviderError extends Error {}

/**
 * A provider endpoint must answer directly. Following a redirect would send the
 * API key to whatever host the redirect names, so it is treated as a failure —
 * and note that workerd does not implement `redirect: "error"`, so the request
 * is made with `"manual"` and the status is checked here instead.
 */
function assertNoRedirect(response: Response): void {
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location") ?? "";
    throw new ProviderError(
      `The provider answered ${response.status}${location ? ` (redirect to ${location.slice(0, 120)})` : ""}; a redirect is not followed, so no key is sent elsewhere.`,
    );
  }
}

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
  const res = await fetchImpl(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  assertNoRedirect(res);
  if (!res.ok) throw new ProviderError(`The provider answered ${res.status}.`);
  return parseResponse(settings.serverApi.provider, await res.json());
}

// ---- per-automation generation (Phase 2/3) ---------------------------------

export type AutomationProviderInput = {
  provider: ServerApiProvider;
  model: string;
  baseUrl: string;
};

export function automationApiSettings(automation: AutomationProviderInput): ServerApiSettings {
  return { provider: automation.provider, model: automation.model, baseUrl: automation.baseUrl };
}

export type GenerateOptions = { fetchImpl?: typeof fetch; timeoutMs?: number; maxTokens?: number };

/** One generation call for an automation, with its own key and its own timeout. */
export async function generateArticle(
  automation: AutomationProviderInput,
  apiKey: string,
  messages: { system: string; prompt: string },
  options: GenerateOptions = {},
): Promise<string> {
  const api = automationApiSettings(automation);
  const { url, init } = buildRequest(api, apiKey, { system: messages.system, prompt: messages.prompt, maxTokens: options.maxTokens ?? 6000 });
  const fetcher = options.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 60_000);
  let res: Response;
  try {
    res = await fetcher(url, { ...init, redirect: "manual", signal });
  } catch (error) {
    throw new ProviderError(
      (error as Error)?.name === "TimeoutError" || (error as Error)?.name === "AbortError"
        ? "The provider did not answer in time."
        : `The provider could not be reached${error instanceof Error && error.message ? ` (${error.message})` : ""}.`,
    );
  }
  assertNoRedirect(res);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ProviderError(`The provider answered ${res.status}${detail ? `: ${detail.slice(0, 300)}` : "."}`);
  }
  return parseResponse(api.provider, await res.json());
}

/**
 * A cheap round trip that proves the credential, the model id and the endpoint
 * work together. Never returns or logs the key.
 */
export async function testProviderConnection(
  automation: AutomationProviderInput,
  apiKey: string,
  options: GenerateOptions = {},
): Promise<{ ok: true; model: string; reply: string }> {
  const model = automation.model || defaultModel(automation.provider);
  if (!model) throw new ProviderError("Set a model id for this provider first.");
  const reply = await generateArticle(
    automation,
    apiKey,
    {
      system: "You are a connection test. Reply with the single word: ready",
      prompt: "Connection test. Reply with the single word: ready",
    },
    { ...options, maxTokens: 24, timeoutMs: options.timeoutMs ?? 20_000 },
  );
  return { ok: true, model, reply: reply.trim().slice(0, 80) };
}

export type BuiltImageRequest = BuiltRequest;

const IMAGE_PATHS: Partial<Record<ServerApiProvider, string>> = {
  openai: "https://api.openai.com/v1/images/generations",
  xai: "https://api.x.ai/v1/images/generations",
};

const IMAGE_MODELS: Partial<Record<ServerApiProvider, string>> = {
  openai: "gpt-image-1",
  xai: "grok-2-image",
};

export function imageGenerationSupported(provider: ServerApiProvider): boolean {
  return Boolean(IMAGE_PATHS[provider]);
}

export function buildImageRequest(api: ServerApiSettings, apiKey: string, prompt: string, model?: string): BuiltRequest {
  const endpoint = IMAGE_PATHS[api.provider];
  if (!endpoint) throw new ProviderError(`Image generation is not supported for ${api.provider}.`);
  const chosen = model?.trim() || IMAGE_MODELS[api.provider] || "";
  const body: Record<string, unknown> = { model: chosen, prompt: prompt.slice(0, 3800), n: 1 };
  if (api.provider === "openai") {
    // JPEG keeps the file inside the 1.5 MB media cap much more reliably than PNG.
    body.size = "1536x1024";
    body.output_format = "jpeg";
    body.output_compression = 80;
  } else {
    body.response_format = "b64_json";
  }
  return {
    url: endpoint,
    init: { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) },
  };
}

export type GeneratedImage = { base64?: string; url?: string };

export function parseImageResponse(data: unknown): GeneratedImage {
  const first = (data as { data?: unknown[] })?.data?.[0] as { b64_json?: unknown; url?: unknown } | undefined;
  if (!first) throw new ProviderError("The provider returned no image.");
  if (typeof first.b64_json === "string" && first.b64_json.length > 0) return { base64: first.b64_json };
  if (typeof first.url === "string" && /^https:\/\//.test(first.url)) return { url: first.url };
  throw new ProviderError("The provider returned an unusable image payload.");
}

export async function generateImage(
  automation: AutomationProviderInput,
  apiKey: string,
  prompt: string,
  options: GenerateOptions = {},
): Promise<GeneratedImage> {
  const api = automationApiSettings(automation);
  const { url, init } = buildImageRequest(api, apiKey, prompt);
  const fetcher = options.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 60_000);
  let res: Response;
  try {
    res = await fetcher(url, { ...init, redirect: "manual", signal });
  } catch (error) {
    throw new ProviderError(
      (error as Error)?.name === "TimeoutError" || (error as Error)?.name === "AbortError"
        ? "The image provider did not answer in time."
        : "The image provider could not be reached.",
    );
  }
  assertNoRedirect(res);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ProviderError(`The image provider answered ${res.status}${detail ? `: ${detail.slice(0, 200)}` : "."}`);
  }
  return parseImageResponse(await res.json());
}
