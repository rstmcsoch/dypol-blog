import type { PublishingPolicy } from "./settings.ts";

/**
 * Quality flags raised on a submitted draft. Any flag keeps the piece a draft.
 */
export type DraftFlag =
  | "too_short"
  | "missing_sources"
  | "insufficient_sources"
  | "invalid_source_url"
  | "placeholder_text"
  | "duplicate_title"
  | "self_reported_uncertain"
  | "needs_featured_image"
  | "unknown_tags_dropped";

const PLACEHOLDER = /\b(lorem ipsum|todo:|tbd\b|\[citation needed\]|insert (link|source|citation)|example\.com)\b/i;

export function sourceProblems(urls: string[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of urls) {
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      const bad =
        url.protocol !== "https:" ||
        host === "localhost" ||
        /^(\d{1,3}\.){3}\d{1,3}$/.test(host) ||
        host.includes(":") ||
        host.endsWith(".example") ||
        host === "example.com" ||
        !host.includes(".");
      (bad ? invalid : valid).push(url.toString());
    } catch {
      invalid.push(raw);
    }
  }
  return { valid: [...new Set(valid)], invalid };
}

export function draftFlags(input: {
  words: number;
  sourceUrls: string[];
  text: string;
  policy: PublishingPolicy;
  duplicateTitle: boolean;
  uncertain: boolean;
  hasImage: boolean;
  droppedTags: number;
}): DraftFlag[] {
  const flags = new Set<DraftFlag>();
  const { valid, invalid } = sourceProblems(input.sourceUrls);
  if (input.words < input.policy.minWords) flags.add("too_short");
  if (invalid.length) flags.add("invalid_source_url");
  if (input.policy.requireSources && valid.length === 0) flags.add("missing_sources");
  else if (input.policy.requireSources && valid.length < input.policy.minSources) flags.add("insufficient_sources");
  if (PLACEHOLDER.test(input.text)) flags.add("placeholder_text");
  if (input.duplicateTitle) flags.add("duplicate_title");
  if (input.uncertain) flags.add("self_reported_uncertain");
  if (!input.hasImage) flags.add("needs_featured_image");
  if (input.droppedTags > 0) flags.add("unknown_tags_dropped");
  return [...flags];
}

/** Flags that do not block publishing on their own. */
const ADVISORY: DraftFlag[] = ["unknown_tags_dropped"];

export type PublishDecision = { publish: true } | { publish: false; reasons: string[] };

export function publishDecision(input: {
  active: { active: boolean; reason: string | null };
  policy: PublishingPolicy;
  status: string;
  categoryId: string;
  flags: DraftFlag[];
  publishedToday: number;
}): PublishDecision {
  const reasons: string[] = [];
  if (!input.active.active) reasons.push(input.active.reason ?? "Automation is not active.");
  if (!input.policy.autoPublish) reasons.push("Auto-publish is off in the publishing policy (default).");
  if (input.status !== "draft") reasons.push(`The article is ${input.status}, not a draft.`);
  if (input.policy.allowedCategoryIds.length === 0) {
    reasons.push("No topics are allowed for automatic publishing yet (admin → Automation → Publishing rules → Allowed topics).");
  } else if (!input.policy.allowedCategoryIds.includes(input.categoryId)) {
    reasons.push("Its topic is not on the policy's allowed list.");
  }
  const blocking = input.flags.filter(
    (flag) => !ADVISORY.includes(flag) && !(flag === "needs_featured_image" && !input.policy.requireFeaturedImage),
  );
  if (blocking.length) reasons.push(`Validation flags: ${blocking.join(", ")}.`);
  if (input.publishedToday >= input.policy.maxPublishedPerDay) {
    reasons.push(`Daily automatic publish limit reached (${input.policy.maxPublishedPerDay}).`);
  }
  return reasons.length ? { publish: false, reasons } : { publish: true };
}
