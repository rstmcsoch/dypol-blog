import { z } from "zod";
import { unsafeUrlReason } from "./image-fetch.ts";

/**
 * Owner-controlled automation settings (site_settings row id 'automation').
 * Defaults are the safe state: automation off, auto-publish off.
 */
/**
 * Who writes the articles:
 *  - "mcp-connector": any AI app (Claude, ChatGPT, Grok, Cursor, ...) calls this
 *    site's MCP tools on its own schedule. The site makes no AI requests.
 *  - "server-api": the site itself would call an AI provider's API with a key
 *    stored as a Worker secret. Abstraction only in this release (see provider.ts).
 * Legacy values "grok-mcp" / "xai-api" are migrated on read.
 */
export const AUTOMATION_MODES = ["mcp-connector", "server-api"] as const;
export type AutomationMode = (typeof AUTOMATION_MODES)[number];

export const SERVER_API_PROVIDERS = ["xai", "openai", "anthropic", "gemini", "openrouter", "openai-compatible"] as const;
export type ServerApiProvider = (typeof SERVER_API_PROVIDERS)[number];

export const serverApiSchema = z
  .object({
    provider: z.enum(SERVER_API_PROVIDERS),
    /** Model id at the provider; empty = adapter default. */
    model: z.string().trim().max(120).regex(/^[A-Za-z0-9._:/@-]*$/, "Model ids use letters, digits and . _ : / @ -"),
    /** Only for openai-compatible: https base URL such as https://api.example.com/v1 */
    baseUrl: z.string().trim().max(300),
  })
  .superRefine((value, ctx) => {
    if (value.provider !== "openai-compatible") return;
    const problem = value.baseUrl ? unsafeUrlReason(value.baseUrl) : "A base URL is required for an OpenAI-compatible provider.";
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["baseUrl"], message: problem });
  });
export type ServerApiSettings = z.infer<typeof serverApiSchema>;

export const IMAGE_TRANSFER_STATES = ["untested", "verified", "unsupported"] as const;

export const publishingPolicySchema = z.object({
  /** Master switch for automatic publishing. Off = everything stays a draft. */
  autoPublish: z.boolean(),
  /** Category ids automation may publish into. Empty = none. */
  allowedCategoryIds: z.array(z.string().min(1).max(80)).max(50),
  minWords: z.number().int().min(100).max(10000),
  requireSources: z.boolean(),
  minSources: z.number().int().min(0).max(20),
  requireFeaturedImage: z.boolean(),
  maxPublishedPerDay: z.number().int().min(0).max(20),
});

export const automationSettingsSchema = z.object({
  enabled: z.boolean(),
  paused: z.boolean(),
  mode: z.enum(AUTOMATION_MODES),
  serverApi: serverApiSchema,
  /** Extra https hosts allowed as OAuth redirect / CORS origins for other MCP clients. */
  extraClientHosts: z
    .array(z.string().trim().toLowerCase().regex(/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Use a host name such as connectors.example.com"))
    .max(20),
  topicIdeas: z.array(z.string().trim().min(1).max(300)).max(50),
  topicSources: z.array(z.string().trim().url().max(500)).max(30),
  policy: publishingPolicySchema,
  imageTransfer: z.enum(IMAGE_TRANSFER_STATES),
});

export type PublishingPolicy = z.infer<typeof publishingPolicySchema>;
export type AutomationSettings = z.infer<typeof automationSettingsSchema>;

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  enabled: false,
  paused: false,
  mode: "mcp-connector",
  serverApi: { provider: "openai", model: "", baseUrl: "" },
  extraClientHosts: [],
  topicIdeas: [],
  topicSources: [],
  policy: {
    autoPublish: false,
    allowedCategoryIds: [],
    minWords: 600,
    requireSources: true,
    minSources: 2,
    requireFeaturedImage: false,
    maxPublishedPerDay: 1,
  },
  imageTransfer: "untested",
};

/** Merges stored data over defaults; anything invalid falls back to the default. */
export function normalizeAutomationSettings(input: unknown): AutomationSettings {
  const raw = { ...((input && typeof input === "object" ? input : {}) as Record<string, unknown>) };
  // Backward compatibility with the Grok-only release.
  if (!("mode" in raw) && typeof raw.provider === "string") {
    raw.mode = raw.provider === "xai-api" ? "server-api" : "mcp-connector";
    if (raw.provider === "xai-api" && !raw.serverApi) raw.serverApi = { provider: "xai", model: "", baseUrl: "" };
  }
  delete raw.provider;
  const merged = {
    ...DEFAULT_AUTOMATION_SETTINGS,
    ...raw,
    serverApi: { ...DEFAULT_AUTOMATION_SETTINGS.serverApi, ...((raw.serverApi as object | undefined) ?? {}) },
    policy: { ...DEFAULT_AUTOMATION_SETTINGS.policy, ...((raw.policy as object | undefined) ?? {}) },
  };
  if (!serverApiSchema.safeParse(merged.serverApi).success) merged.serverApi = DEFAULT_AUTOMATION_SETTINGS.serverApi;
  const parsed = automationSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_AUTOMATION_SETTINGS;
}

export function automationActive(settings: AutomationSettings): { active: boolean; reason: string | null } {
  if (!settings.enabled) return { active: false, reason: "Automation is disabled in the desk." };
  if (settings.paused) return { active: false, reason: "Automation is paused in the desk." };
  return { active: true, reason: null };
}
