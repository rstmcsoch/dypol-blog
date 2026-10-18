import { bodyToBlocks, contentHash, wordCount } from "./body.ts";
import { chooseTopic, looksDuplicate, runKey, slugFromTitle } from "./topics.ts";
import { buildBriefPrompts, GeneratedArticleError, parseGeneratedArticle, type GeneratedArticle } from "./prompt.ts";
import { automationActive, type AutomationRecord } from "./automation.ts";
import { credentialSummary, resolveCredential, type CredentialEnv, type CredentialStatus } from "./credentials.ts";
import { generateArticle, generateImage, imageGenerationSupported, ProviderError } from "./provider.ts";
import { draftFlags, publishDecision, sourceProblems, type DraftFlag } from "./policy.ts";
import { assertUsableCover, decodeBase64Image, fetchImage, ImageIntakeError, type ImageMime } from "./image-fetch.ts";

/**
 * The automation run pipeline: configuration → topic → generation → image →
 * validation → draft → (authorised) publish → log.
 *
 * Every dependency is injectable, so the whole orchestration is unit-tested
 * with fakes (see src/lib/automation/run.test.ts) while production wires it to
 * D1/R2 through the repository. The run's final status always describes what
 * actually happened to the article, never merely that the provider answered.
 */

export type RunStage = "config" | "topic" | "generate" | "image" | "validate" | "save" | "publish" | "done";

export type RunStatus = "succeeded" | "draft" | "failed" | "skipped" | "dry-run";

export type RunOutcome = {
  status: RunStatus;
  stage: RunStage;
  reason: string;
  articleId: string | null;
  slug: string | null;
  attempt: number;
  durationMs: number;
  flags: DraftFlag[];
  published: boolean;
  /** Only in dry runs: what would have been written. */
  preview?: { title: string; excerpt: string; body: string; blocks: number; sources: string[] };
};

export type DraftInput = {
  title: string;
  slug: string;
  excerpt: string;
  categoryId: string;
  tagIds: string[];
  motif: "corner" | "band" | "split" | "stamp" | "stack" | "edge";
  seoTitle: string;
  seoDescription: string;
  blocks: ReturnType<typeof bodyToBlocks>;
};

export type PipelineDeps = {
  fetch: typeof fetch;
  recentTitles: (limit: number) => Promise<string[]>;
  runIndex: (automationId: string) => Promise<number>;
  categories: () => Promise<{ id: string; slug: string; label: string }[]>;
  tags: () => Promise<{ id: string; slug: string; label: string }[]>;
  siteIdentity: () => Promise<{ name: string; description: string }>;
  saveDraft: (input: DraftInput) => Promise<{ id: string; slug: string }>;
  uploadImage: (input: { filename: string; mime: string; alt: string; dataBase64: string }) => Promise<string>;
  attachCover: (articleId: string, mediaId: string) => Promise<void>;
  publishDraft: (articleId: string) => Promise<boolean>;
  publishedToday: (automationId: string) => Promise<number>;
  findDuplicate: (input: { key: string; hash: string }) => Promise<{ articleId: string; matchedBy: "run_key" | "content_hash" } | null>;
  claimRun: (input: { key: string; hash: string; articleId: string; sources: string[]; flags: string[] }) => Promise<boolean>;
  log: (input: {
    automationId: string;
    stage: RunStage;
    status: RunStatus;
    reason: string;
    articleId?: string | null;
    durationMs: number;
    attempt: number;
    details?: Record<string, unknown>;
    tool?: string;
    outcome?: string;
    /** Quality flags raised for this run (advisory; also stored on the submission). */
    flags?: string[];
    published?: boolean;
  }) => Promise<void>;
  /** Optional: record the draft's quality flags for the MCP-style policy check. */
  setFlags?: (articleId: string, flags: string[]) => Promise<void>;
};

export type ExecuteInput = {
  automation: AutomationRecord;
  env: CredentialEnv;
  trigger: "schedule" | "manual" | "retry" | "test";
  dryRun?: boolean;
  /** Overrides the persisted retry count; the scheduler passes the attempt number. */
  attempt?: number;
  deps: Partial<PipelineDeps>;
  now?: Date;
};

const MOTIFS: DraftInput["motif"][] = ["corner", "band", "split", "stamp", "stack", "edge"];

/** Retryable when the provider or network was at fault, not the request. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return /did not answer in time|could not be reached|answered 5\d\d|answered 429/i.test(error.message);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function motifFor(seed: string): DraftInput["motif"] {
  const index = parseInt(seed.slice(0, 2), 16);
  return MOTIFS[Number.isFinite(index) ? index % MOTIFS.length : 0] as DraftInput["motif"];
}

function imageBrief(automation: AutomationRecord, generated: GeneratedArticle, categoryLabel: string): string {
  const owner = automation.imagePrompt.trim();
  const fromModel = generated.imagePrompt.trim();
  const base = owner || fromModel || `${generated.title}. An editorial image for a ${categoryLabel} article.`;
  return `${base}\n\nStyle: photographic or minimal editorial illustration, no text, no lettering, no logos, 16:9 composition.`;
}

/**
 * Runs one automation once. Never throws for an expected failure: the failure is
 * returned (and logged) so the desk can show the exact failing stage.
 */
export async function executeAutomation(input: ExecuteInput): Promise<RunOutcome> {
  const started = Date.now();
  const now = input.now ?? new Date();
  const attempt = Math.max(1, input.attempt ?? 1);
  const deps = input.deps;
  const automation = input.automation;
  const automationId = automation.id;
  const dryRun = input.dryRun ?? false;
  const require = <K extends keyof PipelineDeps>(key: K): PipelineDeps[K] => {
    const value = deps[key];
    if (!value) throw new Error(`Pipeline dependency ${String(key)} is missing.`);
    return value as PipelineDeps[K];
  };

  const finish = async (outcome: Omit<RunOutcome, "durationMs" | "attempt" | "flags" | "published"> & { flags?: DraftFlag[]; published?: boolean }): Promise<RunOutcome> => {
    const durationMs = Date.now() - started;
    const flags = outcome.flags ?? [];
    const published = outcome.published ?? false;
    const logged = {
      automationId,
      stage: outcome.stage,
      status: outcome.status,
      reason: outcome.reason,
      articleId: outcome.articleId,
      durationMs,
      attempt,
      tool: input.trigger === "schedule" ? "scheduled_run" : "manual_run",
      outcome: dryRun ? "dry-run" : outcome.status,
      flags: flags as string[],
      published,
      details: { trigger: input.trigger, dryRun },
    };
    await (deps.log ??
      (async () => {
        /* logging is best effort when the caller supplies none */
      }))(logged);
    return { ...outcome, flags, published, durationMs, attempt };
  };

  // ---- config -------------------------------------------------------------
  const state = automationActive(automation);
  if (!state.active && input.trigger !== "test") {
    return finish({ status: "skipped", stage: "config", reason: state.reason ?? "Automation is not active.", articleId: null, slug: null });
  }
  if (automation.mode !== "server-api") {
    return finish({
      status: "skipped",
      stage: "config",
      reason: "This automation is written by an AI app through the MCP connector; the site makes no AI requests for it.",
      articleId: null,
      slug: null,
    });
  }
  const credential = resolveCredential(automation.credentialRef, input.env);
  if (!credential) {
    const status: CredentialStatus[] = [];
    return finish({
      status: "failed",
      stage: "config",
      reason: `No credential: ${credentialSummary(automation.credentialRef, status)}. Add the Worker secret, then run again.`,
      articleId: null,
      slug: null,
    });
  }
  if (automation.imageMode === "provider" && !imageGenerationSupported(automation.provider)) {
    return finish({ status: "failed", stage: "config", reason: `Image generation is not supported for ${automation.provider}.`, articleId: null, slug: null });
  }

  let categories: { id: string; slug: string; label: string }[] = [];
  let tags: { id: string; slug: string; label: string }[] = [];
  let siteIdentity = { name: "DYPOL Blog", description: "" };
  try {
    categories = await require("categories")();
    tags = await require("tags")();
    siteIdentity = await require("siteIdentity")();
  } catch (error) {
    return finish({ status: "failed", stage: "config", reason: `Could not read the site content: ${message(error)}`, articleId: null, slug: null });
  }
  const category =
    categories.find((item) => item.id === automation.categoryId) ??
    categories.find((item) => automation.allowedCategoryIds.includes(item.id)) ??
    categories[0];
  if (!category) {
    return finish({ status: "failed", stage: "config", reason: "Create a topic first: articles need one.", articleId: null, slug: null });
  }
  const tagIds = automation.tagIds.filter((id) => tags.some((tag) => tag.id === id));

  // ---- topic --------------------------------------------------------------
  let titles: string[] = [];
  let index = 0;
  try {
    titles = await require("recentTitles")(40);
    index = await require("runIndex")(automationId);
  } catch (error) {
    return finish({ status: "failed", stage: "topic", reason: `Could not read recent articles: ${message(error)}`, articleId: null, slug: null });
  }
  const choice = chooseTopic({ automation, recentTitles: titles, runIndex: index });
  if (!choice) {
    return finish({
      status: "skipped",
      stage: "topic",
      reason: "No topic available: add topic ideas or source sites to this automation.",
      articleId: null,
      slug: null,
    });
  }
  if (choice.topic && looksDuplicate(choice.topic, titles)) {
    return finish({ status: "skipped", stage: "topic", reason: `“${choice.topic}” repeats a recent article.`, articleId: null, slug: null });
  }

  // ---- generate (with retries and backoff) --------------------------------
  const brief = buildBriefPrompts({
    automation,
    siteName: siteIdentity.name,
    siteDescription: siteIdentity.description,
    categoryLabel: category.label,
    tagLabels: tags.map((tag) => tag.label),
    topic: choice.topic,
    topicReason: choice.reason,
    sourceUrl: choice.sourceUrl,
    recentTitles: titles,
  });

  const attempts = Math.max(1, Math.min(automation.retryMax + 1, 4));
  let generated: GeneratedArticle | null = null;
  let generateError = "";
  for (let round = 1; round <= attempts; round += 1) {
    try {
      const text = await generateArticle(
        automation,
        credential.value,
        { system: brief.system, prompt: brief.user },
        { fetchImpl: deps.fetch ?? fetch },
      );
      generated = parseGeneratedArticle(text);
      break;
    } catch (error) {
      generateError = message(error);
      const retryable = isRetryable(error) || error instanceof GeneratedArticleError;
      if (round >= attempts || !retryable) break;
      // Exponential backoff, capped so a scheduled run cannot hang for minutes.
      await sleep(Math.min(automation.retryBackoffSeconds * 1000 * 2 ** (round - 1), 30_000));
    }
  }
  if (!generated) {
    return finish({ status: "failed", stage: "generate", reason: generateError || "The provider returned nothing usable.", articleId: null, slug: null });
  }

  // ---- validation (before anything is written) ----------------------------
  const blocks = bodyToBlocks(generated.body);
  if (blocks.length === 0) {
    return finish({ status: "failed", stage: "validate", reason: "The generated body was empty.", articleId: null, slug: null });
  }
  if (blocks.length > 78) {
    return finish({ status: "failed", stage: "validate", reason: `The generated body has ${blocks.length} blocks (max 78).`, articleId: null, slug: null });
  }
  const words = wordCount(blocks);
  const { valid: sources } = sourceProblems(generated.sourceUrls);
  const policy = {
    autoPublish: automation.publishMode === "auto",
    allowedCategoryIds: automation.allowedCategoryIds,
    minWords: automation.minWords,
    requireSources: automation.requireSources,
    minSources: automation.minSources,
    requireFeaturedImage: automation.requireCover,
    maxPublishedPerDay: automation.maxPerDay,
  };
  const duplicateTitle = titles.some((title) => title.trim().toLowerCase() === generated.title.trim().toLowerCase());
  const flags = draftFlags({
    words,
    sourceUrls: generated.sourceUrls,
    text: `${generated.title}\n${generated.excerpt}\n${generated.body}`,
    policy,
    duplicateTitle,
    uncertain: generated.uncertain,
    hasImage: false,
    droppedTags: 0,
  });
  if (generated.sourceUrls.length > 0 && sources.length === 0) {
    flags.push("invalid_source_url");
  }

  if (dryRun) {
    return finish({
      status: "dry-run",
      stage: "validate",
      reason: `Dry run: nothing was saved. ${words} words, ${sources.length} valid source(s), flags: ${flags.length ? flags.join(", ") : "none"}.`,
      articleId: null,
      slug: null,
      flags,
      preview: { title: generated.title, excerpt: generated.excerpt, body: generated.body.slice(0, 8000), blocks: blocks.length, sources },
    });
  }

  // ---- dedupe -------------------------------------------------------------
  const hash = await contentHash(generated.title, generated.body);
  const key = runKey(automationId, now, attempt);
  const duplicate = await require("findDuplicate")({ key, hash });
  if (duplicate) {
    return finish({
      status: "skipped",
      stage: "validate",
      reason: `Duplicate of an existing article (${duplicate.matchedBy === "run_key" ? "the same scheduled slot" : "identical content"}). Nothing was written.`,
      articleId: duplicate.articleId,
      slug: null,
      flags,
    });
  }

  // ---- save draft ---------------------------------------------------------
  let saved: { id: string; slug: string };
  try {
    saved = await require("saveDraft")({
      title: generated.title,
      slug: slugFromTitle(generated.title),
      excerpt: generated.excerpt,
      categoryId: category.id,
      tagIds,
      motif: motifFor(hash),
      seoTitle: generated.seoTitle,
      seoDescription: generated.seoDescription,
      blocks: [...blocks, ...(sources.length ? [{ type: "heading" as const, level: 2 as const, text: "Sources" }, { type: "list" as const, items: sources }] : [])],
    });
  } catch (error) {
    return finish({ status: "failed", stage: "save", reason: `The draft could not be saved: ${message(error)}`, articleId: null, slug: null, flags });
  }
  await require("claimRun")({ key, hash, articleId: saved.id, sources, flags });
  await deps.setFlags?.(saved.id, flags);

  // ---- image --------------------------------------------------------------
  let hasImage = false;
  if (automation.imageMode === "provider") {
    try {
      const image = await generateImage(automation, credential.value, imageBrief(automation, generated, category.label), { fetchImpl: deps.fetch ?? fetch });
      const decoded = image.base64
        ? decodeBase64Image(image.base64)
        : await fetchImage(image.url as string, deps.fetch ?? fetch);
      assertUsableCover(decoded.bytes, decoded.mime as ImageMime);
      let binary = "";
      for (const byte of decoded.bytes) binary += String.fromCharCode(byte);
      const extension = decoded.mime.split("/")[1];
      const mediaId = await require("uploadImage")({
        filename: `${saved.slug || "featured"}.${extension}`,
        mime: decoded.mime,
        alt: generated.title,
        dataBase64: btoa(binary),
      });
      await require("attachCover")(saved.id, mediaId);
      hasImage = true;
    } catch (error) {
      const reason = error instanceof ImageIntakeError || error instanceof ProviderError ? error.message : message(error);
      const nextFlags = [...new Set([...flags, "needs_featured_image" as DraftFlag])];
      await deps.setFlags?.(saved.id, nextFlags);
      if (automation.requireCover) {
        return finish({
          status: "draft",
          stage: "image",
          reason: `Draft saved, but the featured image failed (${reason}). A cover is required, so it was not published.`,
          articleId: saved.id,
          slug: saved.slug,
          flags: nextFlags,
        });
      }
      flags.push("needs_featured_image");
      await (deps.log ?? (async () => undefined))({
        automationId,
        stage: "image",
        status: "draft",
        reason: `Draft saved without a featured image: ${reason}`,
        articleId: saved.id,
        durationMs: 0,
        attempt,
        tool: "run_stage",
        outcome: "warning",
        flags: flags as string[],
        published: false,
      });
    }
  }

  // ---- publish (only when the policy allows it) ---------------------------
  if (automation.publishMode !== "auto") {
    return finish({
      status: "draft",
      stage: "done",
      reason: "Draft saved. This automation never publishes automatically.",
      articleId: saved.id,
      slug: saved.slug,
      flags,
    });
  }
  const publishedToday = await require("publishedToday")(automationId).catch(() => 0);
  const decision = publishDecision({
    active: state,
    policy,
    status: "draft",
    categoryId: category.id,
    flags: hasImage ? flags : [...new Set([...flags, "needs_featured_image" as DraftFlag])],
    publishedToday,
  });
  if (!decision.publish) {
    return finish({
      status: "draft",
      stage: "publish",
      reason: `Draft saved; not published because: ${decision.reasons.join(" ")}`,
      articleId: saved.id,
      slug: saved.slug,
      flags,
    });
  }
  let published = false;
  try {
    published = await require("publishDraft")(saved.id);
  } catch (error) {
    return finish({ status: "failed", stage: "publish", reason: `Publishing failed: ${message(error)}`, articleId: saved.id, slug: saved.slug, flags });
  }
  if (!published) {
    return finish({
      status: "draft",
      stage: "publish",
      reason: "Draft saved; it was no longer a draft when publishing ran (another run or the desk changed it first).",
      articleId: saved.id,
      slug: saved.slug,
      flags,
    });
  }
  return finish({
    status: "succeeded",
    stage: "done",
    reason: `Published “${generated.title}”.`,
    articleId: saved.id,
    slug: saved.slug,
    flags,
    published: true,
  });
}

function message(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 400);
  return "Unknown error.";
}
