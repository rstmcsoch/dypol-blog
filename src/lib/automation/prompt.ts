import type { AutomationRecord } from "./automation.ts";
import { CONTENT_STYLE_LABELS } from "./automation.ts";

/**
 * The writing brief sent to the configured provider. Pure, so the desk can show
 * the exact prompt an automation would send, and so it is unit-tested.
 *
 * The same rules the MCP connector enforces are stated here: no invented
 * sources, no placeholder text, an excerpt, SEO fields, and a strict JSON reply
 * so the pipeline does not have to guess.
 */

export const RESPONSE_CONTRACT = [
  "Reply with ONE JSON object and nothing else (no markdown fence, no commentary):",
  "{",
  '  "title": string,            // specific and accurate, max 120 characters',
  '  "excerpt": string,          // 1-2 sentences, max 300 characters',
  '  "body": string,             // markdown: blank-line paragraphs, "## " sections, "- " lists, "> " quotes',
  '  "seo_title": string,        // max 60 characters',
  '  "seo_description": string,  // max 155 characters',
  '  "tags": string[],           // 0-5 tags from the tag list above, existing tags only',
  '  "source_urls": string[],    // https URLs of pages actually used; [] if none',
  '  "image_prompt": string,     // one sentence describing a fitting editorial photo or illustration',
  '  "uncertain": boolean        // true if any factual claim could not be verified',
  "}",
].join("\n");

export type BriefInput = {
  automation: Pick<
    AutomationRecord,
    | "name"
    | "language"
    | "style"
    | "instructions"
    | "minWords"
    | "topicIdeas"
    | "topicSources"
    | "requireSources"
    | "minSources"
  >;
  siteName: string;
  siteDescription: string;
  categoryLabel: string;
  tagLabels: string[];
  topic: string;
  topicReason: string;
  sourceUrl: string | null;
  recentTitles: string[];
};

export function buildSystemPrompt(input: BriefInput): string {
  const lines = [
    `You are the research writer for ${input.siteName}, an editorial technology publication. ${input.siteDescription}`,
    `Write in ${input.automation.language}. Style: ${CONTENT_STYLE_LABELS[input.automation.style]}.`,
    `Length: at least ${input.automation.minWords} words of substance — no padding, no repetition.`,
    "",
    "Rules, without exception:",
    "- Original writing only. Never copy or closely paraphrase a source; quote sparingly with attribution.",
    "- Never fabricate facts, numbers, dates, quotes, people or citations.",
    "- Every URL in source_urls must be a page you actually read. If a claim cannot be verified, leave it out and set uncertain=true.",
    `- The article is filed under the topic "${input.categoryLabel}".`,
    input.tagLabels.length
      ? `- Tags may only be chosen from: ${input.tagLabels.join(", ")}.`
      : "- No tags exist yet; return an empty tags array.",
    input.automation.requireSources
      ? `- Provide at least ${input.automation.minSources} distinct https source URL(s); without them the piece stays a draft.`
      : "- Sources are optional, but must still be real pages if given.",
    "- Never write placeholder text such as lorem ipsum, TODO, TBD or example.com.",
    input.automation.instructions ? `\nOwner instructions for this automation:\n${input.automation.instructions}` : "",
    "",
    RESPONSE_CONTRACT,
  ];
  return lines.filter((line) => line.length > 0).join("\n");
}

export function buildUserPrompt(input: BriefInput): string {
  const lines: string[] = [];
  if (input.topic) {
    lines.push(`Topic for this piece: ${input.topic}`);
    lines.push(`Why this topic: ${input.topicReason}.`);
  } else if (input.sourceUrl) {
    lines.push(`Choose ONE current topic worth covering from this source site: ${input.sourceUrl}`);
    lines.push("Read that site first, then commit to a single specific story.");
  } else {
    lines.push("Choose ONE current, specific topic that suits this publication. Do not pick something generic.");
  }
  const extraSources = input.sourceUrl
    ? input.automation.topicSources.filter((url) => url !== input.sourceUrl)
    : input.automation.topicSources;
  if (input.topic && extraSources.length > 0) {
    lines.push(`Source sites this owner trusts for grounding: ${extraSources.join(", ")}`);
  }
  if (input.recentTitles.length > 0) {
    lines.push("");
    lines.push("Already published — do not repeat these topics, angles or sources:");
    for (const title of input.recentTitles.slice(0, 30)) lines.push(`- ${title}`);
  }
  lines.push("");
  lines.push("Research the topic properly, then write the article. Return only the JSON object.");
  return lines.join("\n");
}

/** Convenience wrapper used by the pipeline and the desk prompt preview. */
export function buildBriefPrompts(input: BriefInput): { system: string; user: string } {
  return { system: buildSystemPrompt(input), user: buildUserPrompt(input) };
}

export type GeneratedArticle = {
  title: string;
  excerpt: string;
  body: string;
  seoTitle: string;
  seoDescription: string;
  tags: string[];
  sourceUrls: string[];
  imagePrompt: string;
  uncertain: boolean;
};

export class GeneratedArticleError extends Error {}

/**
 * Parse the provider's reply. Tolerates a fenced or chatty reply (some models
 * wrap JSON), but rejects anything without the required fields rather than
 * inventing content.
 */
export function parseGeneratedArticle(text: string): GeneratedArticle {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new GeneratedArticleError("The provider did not return a JSON object.");
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new GeneratedArticleError("The provider's JSON could not be parsed.");
  }
  const value = raw as Record<string, unknown>;
  const str = (key: string): string => (typeof value[key] === "string" ? (value[key] as string).trim() : "");
  const title = str("title");
  const body = str("body");
  const excerpt = str("excerpt");
  if (!title) throw new GeneratedArticleError("The reply has no title.");
  if (!body) throw new GeneratedArticleError("The reply has no body.");
  if (!excerpt) throw new GeneratedArticleError("The reply has no excerpt.");
  const list = (key: string): string[] =>
    Array.isArray(value[key]) ? (value[key] as unknown[]).filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
  return {
    title: title.slice(0, 200),
    excerpt: excerpt.slice(0, 500),
    body,
    seoTitle: str("seo_title").slice(0, 200),
    seoDescription: str("seo_description").slice(0, 300),
    tags: list("tags").slice(0, 5),
    sourceUrls: list("source_urls").slice(0, 20),
    imagePrompt: str("image_prompt").slice(0, 600),
    uncertain: value.uncertain === true,
  };
}
