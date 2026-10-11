import { z } from "zod";

/**
 * Owner-controlled automation settings (site_settings row id 'automation').
 * Defaults are the safe state: automation off, auto-publish off.
 */
export const AI_PROVIDERS = ["grok-mcp", "xai-api"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

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
  provider: z.enum(AI_PROVIDERS),
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
  provider: "grok-mcp",
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
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const merged = {
    ...DEFAULT_AUTOMATION_SETTINGS,
    ...raw,
    policy: { ...DEFAULT_AUTOMATION_SETTINGS.policy, ...((raw.policy as object | undefined) ?? {}) },
  };
  const parsed = automationSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_AUTOMATION_SETTINGS;
}

export function automationActive(settings: AutomationSettings): { active: boolean; reason: string | null } {
  if (!settings.enabled) return { active: false, reason: "Automation is disabled in the desk." };
  if (settings.paused) return { active: false, reason: "Automation is paused in the desk." };
  return { active: true, reason: null };
}
