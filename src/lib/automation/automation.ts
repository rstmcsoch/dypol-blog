import { z } from "zod";
import { parseCron } from "./schedule.ts";
import { AUTOMATION_MODES, SERVER_API_PROVIDERS, defaultModel, type AutomationMode, type ServerApiProvider } from "./settings.ts";
import { isValidTimeZone } from "./timezone.ts";

/**
 * One independent automation (desk → Automation management).
 *
 * Every field here is per-automation: provider, credential reference, topics,
 * content shape, image handling, publishing mode, schedule and retry limits.
 * Two automations never share mutable state, and a credential reference is a
 * Worker *secret name* — never key material (see credentials.ts).
 */

export const TOPIC_SOURCES = ["ideas", "sources", "mixed", "model"] as const;
export type TopicSource = (typeof TOPIC_SOURCES)[number];

export const TOPIC_SOURCE_LABELS: Record<TopicSource, string> = {
  ideas: "My topic list (in order)",
  sources: "My topic list, checked against my source sites",
  mixed: "My topic list, then my source sites",
  model: "The model picks the topic (no list)",
};

export const CONTENT_STYLES = ["editorial", "explainer", "news-brief", "opinion", "tutorial"] as const;
export type ContentStyle = (typeof CONTENT_STYLES)[number];

export const CONTENT_STYLE_LABELS: Record<ContentStyle, string> = {
  editorial: "Editorial essay",
  explainer: "Explainer",
  "news-brief": "News brief",
  opinion: "Opinion piece",
  tutorial: "Tutorial / how-to",
};

export const IMAGE_MODES = ["none", "provider"] as const;
export type ImageMode = (typeof IMAGE_MODES)[number];

/** Providers whose image endpoint this project can actually call. */
export const IMAGE_CAPABLE_PROVIDERS: ServerApiProvider[] = ["openai", "xai"];

export const PUBLISH_MODES = ["draft", "auto"] as const;
export type PublishMode = (typeof PUBLISH_MODES)[number];

/** Credential references (Worker secret names). Exact match only — no cross-provider fallback. */
export const CREDENTIAL_REFS = [
  "AUTOMATION_A_KEY",
  "AUTOMATION_B_KEY",
  "AUTOMATION_C_KEY",
  "AUTOMATION_D_KEY",
  "XAI_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "AI_API_KEY",
] as const;
export type CredentialRef = (typeof CREDENTIAL_REFS)[number];

export { isValidTimeZone };

const cronField = /^(\*|(\d{1,2})(-(\d{1,2}))?|(\*|\d{1,2}(-\d{1,2})?)\/\d{1,2})(,(\*|\d{1,2}(-\d{1,2})?|\d{1,2}-\d{1,2}\/\d{1,2}))*$/;

/**
 * True when the expression is a real 5-field cron the scheduler can run.
 * The regex shape is checked first (fast, permissive), then the same parser the
 * scheduler uses — so the desk can never accept a schedule that would silently
 * never fire (for example an out-of-range "99 * * * *").
 */
export function cronLooksValid(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  if (!parts.every((part) => cronField.test(part))) return false;
  return parseCron(expr) !== null;
}

export const uuidLike = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/i, "Use letters, digits and hyphens.");

export const automationInputSchema = z
  .object({
    name: z.string().trim().min(2, "Give the automation a name.").max(60),
    enabled: z.boolean(),
    paused: z.boolean(),
    mode: z.enum(AUTOMATION_MODES),
    provider: z.enum(SERVER_API_PROVIDERS),
    model: z
      .string()
      .trim()
      .max(120)
      .regex(/^[A-Za-z0-9._:/@-]*$/, "Model ids use letters, digits and . _ : / @ -"),
    baseUrl: z.string().trim().max(300),
    credentialRef: z.union([z.enum(CREDENTIAL_REFS), z.literal("")]),
    topicSource: z.enum(TOPIC_SOURCES),
    topicIdeas: z.array(z.string().trim().min(3).max(300)).max(200),
    topicSources: z.array(z.string().trim().url().max(500)).max(30),
    categoryId: z.string().trim().max(80).nullable(),
    tagIds: z.array(z.string().trim().min(1).max(80)).max(12),
    language: z.string().trim().min(2).max(12),
    style: z.enum(CONTENT_STYLES),
    instructions: z.string().trim().max(4000),
    minWords: z.number().int().min(120).max(6000),
    imageMode: z.enum(IMAGE_MODES),
    imagePrompt: z.string().trim().max(600),
    publishMode: z.enum(PUBLISH_MODES),
    scheduleCron: z.string().trim().max(80),
    timezone: z.string().trim().min(1).max(60),
    maxPerDay: z.number().int().min(0).max(20),
    retryMax: z.number().int().min(0).max(3),
    retryBackoffSeconds: z.number().int().min(10).max(3600),
    requireSources: z.boolean(),
    minSources: z.number().int().min(0).max(10),
    requireCover: z.boolean(),
    allowedCategoryIds: z.array(z.string().trim().min(1).max(80)).max(50),
    mcpDefault: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.scheduleCron && !cronLooksValid(value.scheduleCron)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scheduleCron"], message: "Use five fields, e.g. 0 8 * * * (minute hour day month weekday)." });
    }
    if (value.scheduleCron && !isValidTimeZone(value.timezone)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["timezone"], message: "Unknown timezone. Use an IANA name such as Asia/Kolkata." });
    }
    if (value.mode === "server-api" && !value.credentialRef) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["credentialRef"], message: "Choose which Worker secret holds this automation's API key." });
    }
    if (value.mode === "server-api" && value.provider === "openai-compatible" && !value.baseUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["baseUrl"], message: "An https base URL is required for an OpenAI-compatible provider." });
    }
    if (value.imageMode === "provider" && !IMAGE_CAPABLE_PROVIDERS.includes(value.provider)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imageMode"],
        message: `Image generation is not supported for this provider. Choose “No featured image” or switch to ${IMAGE_CAPABLE_PROVIDERS.join("/")}.`,
      });
    }
    if (value.publishMode === "auto" && value.allowedCategoryIds.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["allowedCategoryIds"], message: "Tick at least one topic automation may publish into." });
    }
  });

export type AutomationInput = z.infer<typeof automationInputSchema>;

export type AutomationRecord = AutomationInput & {
  id: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_AUTOMATION_INPUT: AutomationInput = {
  name: "Primary automation",
  enabled: false,
  paused: false,
  mode: "mcp-connector",
  provider: "openai",
  model: "",
  baseUrl: "",
  credentialRef: "",
  topicSource: "ideas",
  topicIdeas: [],
  topicSources: [],
  categoryId: null,
  tagIds: [],
  language: "en",
  style: "editorial",
  instructions: "",
  minWords: 600,
  imageMode: "none",
  imagePrompt: "",
  publishMode: "draft",
  scheduleCron: "",
  timezone: "UTC",
  maxPerDay: 1,
  retryMax: 2,
  retryBackoffSeconds: 60,
  requireSources: true,
  minSources: 2,
  requireCover: false,
  allowedCategoryIds: [],
  mcpDefault: true,
};

/** A short, unique, url-safe id derived from the automation name. */
export function automationIdFromName(name: string, taken: string[] = []): string {
  const base =
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "automation";
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 200; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function automationActive(record: Pick<AutomationRecord, "enabled" | "paused">): { active: boolean; reason: string | null } {
  if (!record.enabled) return { active: false, reason: "Automation is disabled." };
  if (record.paused) return { active: false, reason: "Automation is paused." };
  return { active: true, reason: null };
}

/** Whether this automation may be driven by the shared MCP endpoint. */
export function mcpRunnable(record: Pick<AutomationRecord, "mode">): boolean {
  return record.mode === "mcp-connector";
}

export function scheduleSummary(record: Pick<AutomationRecord, "scheduleCron" | "timezone">): string {
  if (!record.scheduleCron) return "No schedule (manual runs only)";
  return `${record.scheduleCron} · ${record.timezone}`;
}

export function cronPresets(): { label: string; cron: string }[] {
  return [
    { label: "Every day at 08:00", cron: "0 8 * * *" },
    { label: "Every day at 18:00", cron: "0 18 * * *" },
    { label: "Twice a day (08:00 and 18:00)", cron: "0 8,18 * * *" },
    { label: "Every Monday at 09:00", cron: "0 9 * * 1" },
    { label: "Every 6 hours", cron: "0 */6 * * *" },
    { label: "Every hour", cron: "0 * * * *" },
  ];
}

/** The model the provider uses when this automation leaves the field blank. */
export function defaultModelFor(provider: ServerApiProvider): string {
  return defaultModel(provider);
}

export function providerNeedsBaseUrl(provider: ServerApiProvider): boolean {
  return provider === "openai-compatible";
}

export type { AutomationMode, ServerApiProvider };
