import { z } from "zod";
import { unsafeUrlReason } from "./image-fetch.ts";
import { DEFAULT_SCHEDULE, SCHEDULE_DAYS } from "./schedule.ts";
import { DEFAULT_TOPIC_SELECTION, TOPIC_FALLBACKS, TOPIC_SELECTION_MODES, TREND_SOURCES } from "./topic-selection.ts";

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

export const scheduleSchema = z.object({
  /** IANA timezone name, e.g. Asia/Kolkata. Display/guidance only — see schedule.ts. */
  timezone: z.string().trim().min(1).max(60).refine((tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } }, "Use an IANA timezone such as Asia/Kolkata"),
  /** Local times the owner set in their AI app, "HH:MM" 24-hour. */
  times: z.array(z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Use HH:MM")).max(4),
  /** Days the AI app runs; empty = every day. */
  days: z.array(z.enum(SCHEDULE_DAYS)).max(7),
});
export type AutomationScheduleInput = z.infer<typeof scheduleSchema>;

/** Max topic ideas per profile. 500 ideas x ~300 chars is ~150 KB of JSON — fine for one D1 row. */
export const MAX_TOPIC_IDEAS = 500;

export const topicSelectionSchema = z.object({
  mode: z.enum(TOPIC_SELECTION_MODES),
  step: z.number().int().min(1).max(20),
  trendSources: z.array(z.enum(TREND_SOURCES)).max(4),
  fallback: z.enum(TOPIC_FALLBACKS),
});
export type TopicSelectionInput = z.infer<typeof topicSelectionSchema>;

export const automationSettingsSchema = z.object({
  topicSelection: topicSelectionSchema,
  schedule: scheduleSchema,
  enabled: z.boolean(),
  paused: z.boolean(),
  mode: z.enum(AUTOMATION_MODES),
  serverApi: serverApiSchema,
  /** Extra https hosts allowed as OAuth redirect / CORS origins for other MCP clients. */
  extraClientHosts: z
    .array(z.string().trim().toLowerCase().regex(/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Use a host name such as connectors.example.com"))
    .max(20),
  /** When true, any automation profile may edit drafts created by other profiles (or by the owner). Off = own drafts only; the master token can always edit all drafts. */
  aiMayEditAllDrafts: z.boolean().default(false),
  topicIdeas: z.array(z.string().trim().min(1).max(300)).max(MAX_TOPIC_IDEAS),
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
  aiMayEditAllDrafts: false,
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
  schedule: DEFAULT_SCHEDULE,
  topicSelection: DEFAULT_TOPIC_SELECTION,
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
    schedule: { ...DEFAULT_SCHEDULE, ...((raw.schedule as object | undefined) ?? {}) },
    topicSelection: { ...DEFAULT_TOPIC_SELECTION, ...((raw.topicSelection as object | undefined) ?? {}) },
  };
  if (!serverApiSchema.safeParse(merged.serverApi).success) merged.serverApi = DEFAULT_AUTOMATION_SETTINGS.serverApi;
  const parsed = automationSettingsSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  // One bad field must not silently reset (and disable) everything: fall back field by field.
  const shape = automationSettingsSchema.shape as Record<string, z.ZodType>;
  const out: Record<string, unknown> = { ...DEFAULT_AUTOMATION_SETTINGS };
  for (const key of Object.keys(shape)) {
    const value = (merged as Record<string, unknown>)[key];
    if (key === "policy") {
      const pol: Record<string, unknown> = { ...DEFAULT_AUTOMATION_SETTINGS.policy };
      const polShape = publishingPolicySchema.shape as Record<string, z.ZodType>;
      for (const k of Object.keys(polShape)) {
        const v = (value as Record<string, unknown>)?.[k];
        if (polShape[k].safeParse(v).success) pol[k] = v;
      }
      out.policy = pol;
    } else if (key === "topicSelection") {
      const sel: Record<string, unknown> = { ...DEFAULT_TOPIC_SELECTION };
      const selShape = topicSelectionSchema.shape as Record<string, z.ZodType>;
      for (const k of Object.keys(selShape)) {
        const v = (value as Record<string, unknown>)?.[k];
        if (selShape[k].safeParse(v).success) sel[k] = v;
      }
      out.topicSelection = sel;
    } else if (key === "schedule") {
      const sch: Record<string, unknown> = { ...DEFAULT_SCHEDULE };
      const schShape = scheduleSchema.shape as Record<string, z.ZodType>;
      for (const k of Object.keys(schShape)) {
        const v = (value as Record<string, unknown>)?.[k];
        if (schShape[k].safeParse(v).success) sch[k] = v;
      }
      out.schedule = sch;
    } else if (shape[key].safeParse(value).success) {
      out[key] = value;
    } else if (Array.isArray(value) && shape[key] instanceof z.ZodArray) {
      const element = (shape[key] as z.ZodArray<z.ZodType>).element;
      const kept = value.filter((item) => element.safeParse(item).success);
      if (shape[key].safeParse(kept).success) out[key] = kept;
    }
  }
  return automationSettingsSchema.parse(out);
}

export function automationActive(settings: AutomationSettings): { active: boolean; reason: string | null } {
  if (!settings.enabled) return { active: false, reason: "Automation is turned off in the admin panel." };
  if (settings.paused) return { active: false, reason: "Automation is paused in the admin panel." };
  return { active: true, reason: null };
}
