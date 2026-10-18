import type { KeyEnv } from "@/lib/automation/provider";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { workerEnv } from "@/lib/cf-env.server";
import { writesAllowed } from "@/lib/write-guard.server";
import { automationActive, type AutomationSettings } from "@/lib/automation/settings";
import { bodyToBlocks, contentHash, wordCount } from "@/lib/automation/body";
import { draftFlags, publishDecision, sourceProblems, type DraftFlag } from "@/lib/automation/policy";
import { effectiveRun, limitVerdict, type EffectiveRun } from "@/lib/automation/publish-limits";
import { assertUsableCover, decodeBase64Image, fetchImage, ImageIntakeError, MAX_IMAGE_BYTES, type ImageMime } from "@/lib/automation/image-fetch";
import { providerStatus } from "@/lib/automation/provider";
import { advanceCursor, computeTopicSelection } from "@/lib/automation/topic-selection";
import { MAX_TOPICS_PER_ARTICLE, effectiveAllowedTopics, filingGuidance, mergeTopicRefs, resolveTopicRefs, unknownTopicsError } from "@/lib/topics";
import { topicSignals } from "@/lib/automation/topic-signals";
import { blocksToBody } from "@/lib/automation/body";
import type { AiActor } from "@/lib/automation/ai-edit";
import type { ToolDefinition, ToolResult } from "./protocol";
import type { ArticleBlock, CoverMotif } from "@/content/types";

/**
 * The twelve automation tools. Each one authorises against the owner's automation
 * settings; writes also require a writable deployment. They reuse the existing
 * content services (saveArticle, uploadMedia) and validation. There is no SQL
 * passthrough and no access to the admin session.
 */

const MAX_BODY_CHARS = 60_000;
const MOTIFS: CoverMotif[] = ["corner", "band", "split", "stamp", "stack", "edge"];

const keySchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/, "Use letters, digits, _ . : -");
const articleIdSchema = z.string().trim().min(1).max(80);

const submitSchema = z.object({
  idempotency_key: keySchema.describe("Stable per-article key, e.g. '2026-10-11-topic-slug'. Retries with the same key never duplicate."),
  title: z.string().trim().min(5).max(200),
  slug: z.string().trim().max(80).regex(/^[a-z0-9-]*$/, "lowercase letters, digits, hyphens").optional(),
  excerpt: z.string().trim().min(20).max(500),
  body: z
    .string()
    .min(1)
    .max(MAX_BODY_CHARS)
    .describe("Article body. Paragraphs separated by blank lines; '## ' / '### ' headings; '- ' lists; '> ' quotes; ``` code. No HTML."),
  topics: z
    .array(z.string().trim().min(1).max(120))
    .min(1)
    .max(MAX_TOPICS_PER_ARTICLE)
    .optional()
    .describe(
      "The blog's topics this article belongs under, picked by its actual content: 1 to " +
        MAX_TOPICS_PER_ARTICLE +
        " entries, each a topic slug or exact topic name from get_blog_settings (field `topics`). The first is the main topic. An article can belong to several topics. Unknown topics are rejected with the valid list, so you can retry.",
    ),
  category: z.string().trim().min(1).max(80).optional().describe("Legacy single topic (id, slug or label). Prefer `topics`; when both are sent they are merged, topics first."),
  tags: z.array(z.string().trim().min(1).max(80)).max(8).optional().describe("Existing tag ids/slugs/labels. Unknown tags are dropped."),
  seo_title: z.string().trim().max(200).optional(),
  seo_description: z.string().trim().max(300).optional(),
  source_urls: z.array(z.string().trim().max(500)).max(20).describe("https URLs of sources actually used. Never invent citations."),
  topic_idea_used: z.string().trim().max(300).optional().describe("The topic idea from get_blog_settings selection that this draft uses (sequence/random modes)."),
  used_topic_index: z.number().int().min(0).max(10000).optional().describe("Index of the topic idea used, from selection.suggestedIndex. In sequence mode the server advances its cursor only when a draft is submitted."),
  cover_media_id: z.string().trim().min(1).max(80).optional().describe("Media id returned by an earlier upload_featured_image call (without article_id). Attached as the cover; lets the draft be auto-published in this same call if policy passes."),
  uncertain: z.boolean().optional().describe("Set true if any claim could not be verified; the piece will stay a draft."),
  notes: z.string().trim().max(1000).optional().describe("Notes for the editor (not published)."),
  run_id: z.string().trim().max(80).optional().describe("One ID per automation execution (e.g. 'morning-2026-10-18'). Reuse the same run_id for every submit/publish call in one run: the per-run publish limit counts publishes per run_id. Omit it and publishes are grouped by a 30-minute burst instead."),

}).refine((v) => (v.topics?.length ?? 0) > 0 || Boolean(v.category), "Provide `topics` (1-" + MAX_TOPICS_PER_ARTICLE + " of the blog's topics) — or the legacy `category`.");

const listSchema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
  status: z.enum(["draft", "published", "unpublished"]).optional(),
});

const publishSchema = z.object({
  article_id: articleIdSchema,
  run_id: z.string().trim().max(80).optional().describe("One ID per automation execution (e.g. 'morning-2026-10-18'). Reuse the same run_id for every submit/publish call in one run: the per-run publish limit counts publishes per run_id. Omit it and publishes are grouped by a 30-minute burst instead."),
});

const getArticleSchema = z.object({ article_id: articleIdSchema });

const listEditableSchema = z.object({ limit: z.number().int().min(1).max(50).optional() });

const refList = z.array(z.string().trim().min(1).max(80)).max(24);
const updateDraftSchema = z
  .object({
    article_id: articleIdSchema,
    title: z.string().trim().min(5).max(200).optional(),
    slug: z.string().trim().max(80).regex(/^[a-z0-9-]*$/, "lowercase letters, digits, hyphens").optional(),
    excerpt: z.string().trim().min(20).max(500).optional(),
    body: z.string().min(1).max(MAX_BODY_CHARS).optional().describe("Full replacement body, same format as submit_article_draft. The Sources section is rebuilt from source_urls."),
    category: z.string().trim().min(1).max(80).optional().describe("Legacy: set the single main topic. Prefer `topics`."),
    topics: z.array(z.string().trim().min(1).max(120)).min(1).max(MAX_TOPICS_PER_ARTICLE).optional().describe("Replace the full topic set (1-" + MAX_TOPICS_PER_ARTICLE + " topic slugs or exact names from get_blog_settings). The first is the main topic."),
    add_topics: refList.optional().describe("Add topics (slugs or exact names). Unknown topics are rejected with the valid list."),
    remove_topics: refList.optional().describe("Remove topics (slugs or exact names). At least one topic must remain."),
    tags: refList.optional().describe("Replace the full tag set (existing tag ids/slugs/labels)."),
    add_tags: refList.optional(),
    remove_tags: refList.optional(),
    seo_title: z.string().trim().max(200).optional(),
    seo_description: z.string().trim().max(300).optional(),
    source_urls: z.array(z.string().trim().max(500)).max(20).optional().describe("Replace the source list; the Sources section of the body is rebuilt."),
  })
  .refine((v) => Object.keys(v).length > 1, "Provide at least one field to change.");

const setCoverSchema = z.object({ article_id: articleIdSchema, media_id: z.string().trim().min(1).max(80).describe("Existing media id (from upload_featured_image without article_id, or the media library).") });
const removeCoverSchema = z.object({ article_id: articleIdSchema });
const deleteDraftSchema = z.object({
  article_id: articleIdSchema,
  confirm: z.literal(true).describe("Must be true — deletion is permanent."),
  slug: z.string().trim().min(1).max(80).describe("Echo the article's current slug to prove you are deleting the right draft."),
  delete_cover_if_unused: z.boolean().optional().describe("Also delete the cover image file if nothing else uses it (same rule as the admin panel). Default false: the file is kept."),
});

const imageSchema = z
  .object({
    article_id: articleIdSchema.optional().describe("Automation-created draft to attach the image to as its cover."),
    image_base64: z.string().max(14_000_000).optional().describe("JPEG/PNG/WebP bytes, base64 (max 10 MB decoded). Prefer the url option for large generated images when your app can host them."),
    url: z.string().trim().max(2000).optional().describe("Public https image URL (fetched with SSRF protection)."),
    filename: z.string().trim().max(120).optional(),
    alt: z.string().trim().min(1).max(200).describe("Alt text describing the image."),
    credit: z
      .string()
      .trim()
      .max(300)
      .optional()
      .describe('Required for images you did not create: "Photo: <author> / <source>, <license>" (e.g. "Photo: Jane Doe / Wikimedia Commons, CC BY-SA 4.0").'),
    source_page: z.string().trim().url().max(500).optional().describe("Page where the image and its license are shown (for attribution)."),
    run_id: z.string().trim().max(80).optional().describe("One ID per automation execution; reuse it on every submit/publish call in the run (per-run publish limit)."),
  })
  .refine((v) => Boolean(v.image_base64) !== Boolean(v.url), "Provide exactly one of image_base64 or url.");

const runSchema = z.object({
  topic_idea_used: z.string().trim().max(300).optional().describe("Topic idea this run used (recorded; does not advance the sequence cursor — submit_article_draft does)."),
  used_topic_index: z.number().int().min(0).max(10000).optional(),
  outcome: z.enum(["skipped", "completed", "failed"]),
  reason: z.string().trim().min(1).max(500),
  article_id: articleIdSchema.optional(),
  topic: z.string().trim().max(300).optional(),
});

function schemaOf(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

function invalid(error: z.ZodError): ToolResult {
  return {
    ok: false,
    error: "Invalid input.",
    data: error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

type Ctx = { auth: string; profileId?: string };

async function loadSettings(profileId: string) {
  const { readProfileSettings } = await import("@/content/automation.server");
  return readProfileSettings(profileId);
}

async function writeGate(settings: AutomationSettings): Promise<string | null> {
  const active = automationActive(settings);
  if (!active.active) return active.reason;
  if (!(await writesAllowed())) return "This deployment is read-only for automation.";
  return null;
}

async function taxonomy() {
  const sql = await getSql();
  const categories = await sql<{ id: string; slug: string; label: string; description: string }>`
    select id, slug, label, description from categories order by label`;
  const tags = await sql<{ id: string; slug: string; label: string }>`select id, slug, label from tags order by label`;
  return { categories, tags };
}

/**
 * t64 two-tier publish limits. Website cap (Settings, whole site per
 * UTC day, auto + explicit, all profiles) and per-run cap (Automation
 * tab, per profile). Counting includes in-flight claims, and a claim
 * row is written before the status flip (see automation.server), so
 * concurrent automations cannot both slip under a cap unnoticed; the
 * claim is settled to the final outcome or released on abort.
 */
async function publishLimitContext(profileId: string, policy: AutomationSettings["policy"], runId?: string | null) {
  const store = await import("@/content/automation.server");
  const [all, mine, websiteCap] = await Promise.all([
    store.aiPublishUsageToday(),
    store.aiPublishUsageToday(profileId),
    store.readWebsiteAiDailyLimit(),
  ]);
  const run = effectiveRun(profileId, runId, mine);
  const verdict = limitVerdict({ websiteUsed: all.length, websiteCap, runUsed: run.used, runCap: policy.maxPublishedPerRun });
  return { store, run, websiteCap, websiteUsed: all.length, verdict };
}

type PublishClaim = { claimId: string | null; run: EffectiveRun };

async function claimPublish(
  ctx: Awaited<ReturnType<typeof publishLimitContext>>,
  profileId: string,
  policy: AutomationSettings["policy"],
  input: { articleId: string; auth: string; mode: "automatic" | "explicit"; runId?: string | null },
): Promise<{ ok: true; claim: PublishClaim } | { ok: false; reason: string }> {
  if (ctx.verdict.blocked) {
    return { ok: false, reason: ctx.verdict.websiteReason ?? ctx.verdict.runReason ?? "Publish limit reached." };
  }
  const claimId = await ctx.store.claimAiPublish({ profileId, runKey: ctx.run.runKey, mode: input.mode, articleId: input.articleId, auth: input.auth });
  // Recount including other in-flight claims; abort if a concurrent
  // publish pushed usage over a cap in the meantime. Our own claim is
  // excluded from the recount (it is the publish being attempted).
  const recount = await publishLimitContext(profileId, policy, input.runId);
  const othersBlocked = limitVerdict({
    websiteUsed: Math.max(0, recount.websiteUsed - 1),
    websiteCap: recount.websiteCap,
    runUsed: Math.max(0, recount.run.used - 1),
    runCap: policy.maxPublishedPerRun,
  }).blocked;
  if (othersBlocked) {
    await ctx.store.releaseAiPublishClaim(claimId);
    return { ok: false, reason: "Publish limit reached." };
  }
  return { ok: true, claim: { claimId, run: ctx.run } };
}

/**
 * Evaluates the publishing policy for an automation draft and publishes it
 * in the same call when every rule passes. Used by submit (with a cover),
 * by upload_featured_image (after attaching), and by the publish tool, so
 * an AI that forgets the separate publish step no longer strands a
 * publishable draft. Returns clear reasons when it stays a draft.
 */
async function attemptAutoPublish(articleId: string, profileId: string, auth: string, runId?: string | null): Promise<{ published: boolean; status: string; reasons: string[] }> {
  const store = await import("@/content/automation.server");
  const settings = await loadSettings(profileId);
  const submission = await store.findSubmission({ articleId });
  if (!submission) return { published: false, status: "draft", reasons: ["Only drafts created by automation can be published by automation."] };
  if ((submission.profileId ?? "default") !== profileId) return { published: false, status: "draft", reasons: ["That draft was created by a different automation profile; only that profile (or the owner) can publish it."] };
  const sql = await getSql();
  const rows = await sql<{ status: string; category_id: string; slug: string }>`select status, category_id, slug from articles where id = ${articleId}`;
  if (!rows[0]) return { published: false, status: "missing", reasons: ["That article no longer exists."] };
  const policy = await decisionPolicy(settings);
  const ctx = await publishLimitContext(profileId, policy, runId);
  const decision = publishDecision({ active: automationActive(settings), policy, status: rows[0].status, categoryIds: await topicIdsOf(articleId, rows[0].category_id), flags: submission.flags as DraftFlag[], publishedThisRun: ctx.run.used });
  if (!decision.publish) {
    await store.recordRun({ profileId, tool: "publish_article_if_allowed", outcome: "kept_draft", reason: decision.reasons.join(" "), articleId, auth, details: { mode: "automatic", runKey: ctx.run.runKey } });
    return { published: false, status: rows[0].status, reasons: decision.reasons };
  }
  if (ctx.verdict.blocked) {
    const reason = ctx.verdict.websiteReason ?? ctx.verdict.runReason ?? "Publish limit reached.";
    await store.recordRun({ profileId, tool: "publish_article_if_allowed", outcome: "kept_draft", reason, articleId, auth, details: { mode: "automatic", runKey: ctx.run.runKey } });
    return { published: false, status: rows[0].status, reasons: [reason] };
  }
  if (!(await writesAllowed())) return { published: false, status: rows[0].status, reasons: ["This deployment is read-only."] };
  const claimed = await claimPublish(ctx, profileId, policy, { articleId, auth, mode: "automatic", runId });
  if (!claimed.ok) {
    await store.recordRun({ profileId, tool: "publish_article_if_allowed", outcome: "kept_draft", reason: claimed.reason, articleId, auth, details: { mode: "automatic", runKey: ctx.run.runKey } });
    return { published: false, status: rows[0].status, reasons: [claimed.reason] };
  }
  const now = new Date().toISOString();
  await sql`update articles set status = 'published', published_at = ${now}, updated_at = ${now} where id = ${articleId} and status = 'draft'`;
  await store.settleAiPublishClaim(claimed.claim.claimId, "published", { mode: "automatic", runKey: claimed.claim.run.runKey });
  return { published: true, status: "published", reasons: [] };
}

/**
 * Explicit, deliberate publish via MCP (the publish tool). Rustam's rule:
 * AI has full control over drafts — an explicit publish call is the owner's
 * instruction, so publishing POLICY (category allow-list, flags,
 * autoPublish on/off, featured-image requirement) must not block it. Those
 * rules only govern the AUTOMATIC path (submit / cover attach). The
 * owner's HARD limits do block it (t64): the whole-website daily cap
 * (Settings) and the per-run cap (Automation tab) count every AI
 * publish, automatic or explicit. Ownership
 * still applies exactly as for editing, the caller's automation kill switch
 * (enabled/paused) and read-only deployments still apply, and policy items
 * that would have failed are returned as warnings for transparency.
 */
async function explicitPublish(
  articleId: string,
  profileId: string,
  auth: string,
  runId?: string | null,
): Promise<{ published: boolean; status: string; alreadyPublished?: boolean; reasons: string[]; warnings: string[]; slug?: string }> {
  const store = await import("@/content/automation.server");
  const settings = await loadSettings(profileId);
  const blocked = await writeGate(settings);
  if (blocked) {
    await store.recordRun({ profileId, tool: "publish_article_if_allowed", outcome: "refused", reason: blocked, articleId, auth, details: { mode: "explicit" } });
    return { published: false, status: "blocked", reasons: [blocked], warnings: [] };
  }
  const sql = await getSql();
  const rows = await sql<{ status: string; slug: string; category_id: string; published_at: string | null }>`select status, slug, category_id, published_at from articles where id = ${articleId}`;
  if (!rows[0]) return { published: false, status: "missing", reasons: ["That article no longer exists."], warnings: [] };
  if (rows[0].status === "published") {
    return {
      published: false,
      status: "published",
      alreadyPublished: true,
      reasons: ["That article is already published. AI cannot re-publish or change its status — only the owner can do that, in the admin panel."],
      warnings: [],
      slug: rows[0].slug,
    };
  }
  // Ownership guard (repository layer): own profile, master, or edit-others setting.
  const repo = await import("@/content/repository.server");
  const actor: AiActor = { profileId, isMaster: profileId === "default", editAllDrafts: settings.aiMayEditAllDrafts };
  try {
    await repo.getArticleForAi(articleId, actor, "publish");
  } catch (error) {
    const message = error instanceof Error ? error.message : "That draft cannot be published by your profile.";
    await store.recordRun({ profileId, tool: "publish_article_if_allowed", outcome: "refused", reason: message, articleId, auth, details: { mode: "explicit" } });
    return { published: false, status: rows[0].status, reasons: [message], warnings: [] };
  }
  // Warnings only: what the AUTOMATIC policy would have said. Never blocks.
  const submission = await store.findSubmission({ articleId });
  const policy = await decisionPolicy(settings);
  const ctx = await publishLimitContext(profileId, policy, runId);
  const decision = publishDecision({
    active: automationActive(settings),
    policy,
    status: "draft",
    categoryIds: await topicIdsOf(articleId, rows[0].category_id),
    flags: (submission?.flags ?? []) as DraftFlag[],
    publishedThisRun: ctx.run.used,
  });
  const warnings = decision.publish ? [] : decision.reasons;
  // The owner's hard limits DO block explicit publishes (t64): the
  // whole-website daily cap and the per-run cap count every AI publish.
  if (ctx.verdict.blocked) {
    const reason = ctx.verdict.websiteReason ?? ctx.verdict.runReason ?? "Publish limit reached.";
    await store.recordRun({ profileId, tool: "publish_article_if_allowed", outcome: "refused", reason, articleId, auth, details: { mode: "explicit", runKey: ctx.run.runKey } });
    return { published: false, status: rows[0].status, reasons: [reason], warnings };
  }
  const claimed = await claimPublish(ctx, profileId, policy, { articleId, auth, mode: "explicit", runId });
  if (!claimed.ok) {
    await store.recordRun({ profileId, tool: "publish_article_if_allowed", outcome: "refused", reason: claimed.reason, articleId, auth, details: { mode: "explicit", runKey: ctx.run.runKey } });
    return { published: false, status: rows[0].status, reasons: [claimed.reason], warnings };
  }
  const now = new Date().toISOString();
  await sql`update articles set status = 'published', published_at = ${rows[0].published_at ?? now}, updated_at = ${now}
    where id = ${articleId} and status in ('draft', 'unpublished')`;
  await store.settleAiPublishClaim(claimed.claim.claimId, "published_explicit", { mode: "explicit", warnings, runKey: claimed.claim.run.runKey });
  return { published: true, status: "published", reasons: [], warnings, slug: rows[0].slug };
}

/** All topic ids of an article, primary first. Falls back to [category_id] before migration 0007. */
async function topicIdsOf(articleId: string, primaryCategoryId: string): Promise<string[]> {
  try {
    const sql = await getSql();
    const rows = await sql<{ category_id: string }>`select category_id from article_topics where article_id = ${articleId} order by rowid`;
    const ids = rows.map((r) => r.category_id);
    return ids.length ? [primaryCategoryId, ...ids.filter((id) => id !== primaryCategoryId)] : [primaryCategoryId];
  } catch {
    return [primaryCategoryId];
  }
}

/** Topic labels per article id, for list tools. */
async function topicLabelsOf(articleIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (articleIds.length === 0) return out;
  try {
    const { categories } = await taxonomy();
    const labelOf = new Map(categories.map((c) => [c.id, c.label]));
    const sql = await getSql();
    for (let start = 0; start < articleIds.length; start += 50) {
      const chunk = articleIds.slice(start, start + 50);
      const placeholders = chunk.map((_, i) => `$${i + 1}`).join(", ");
      const links = await sql.query<{ article_id: string; category_id: string }>(
        `select article_id, category_id from article_topics where article_id in (${placeholders}) order by rowid`,
        chunk,
      );
      for (const link of links) {
        const list = out.get(link.article_id) ?? [];
        const label = labelOf.get(link.category_id);
        if (label && !list.includes(label)) list.push(label);
        out.set(link.article_id, list);
      }
    }
  } catch {
    /* pre-migration database: lists just omit extra topics */
  }
  return out;
}

/**
 * The publishing policy with a migration-safe topic allowlist: empty means
 * all topics allowed, and a stored list naming only topics that no longer
 * exist (pre-migration ids in profile settings) also means all topics.
 */
async function decisionPolicy(settings: AutomationSettings): Promise<AutomationSettings["policy"]> {
  const { categories } = await taxonomy();
  return { ...settings.policy, allowedCategoryIds: effectiveAllowedTopics(settings.policy.allowedCategoryIds, categories.map((c) => c.id)) };
}

function pick<T extends { id: string; slug: string; label: string }>(items: T[], ref: string): T | undefined {
  const needle = ref.trim().toLowerCase();
  return items.find((i) => i.id.toLowerCase() === needle || i.slug === needle || i.label.toLowerCase() === needle);
}

function sourcesBlocks(urls: string[]): ArticleBlock[] {
  return urls.length ? [{ type: "heading", level: 2, text: "Sources" }, { type: "list", items: urls }] : [];
}

function stripSourcesSection(blocks: ArticleBlock[]): ArticleBlock[] {
  const idx = blocks.findIndex((b) => b.type === "heading" && b.text === "Sources");
  return idx === -1 ? blocks : blocks.slice(0, idx);
}

export function buildTools(ctx: Ctx): ToolDefinition[] {
  const { auth } = ctx;
  const profileId = ctx.profileId ?? "default";

  const actorFor = (settings: AutomationSettings): AiActor => ({ profileId, isMaster: profileId === "default", editAllDrafts: settings.aiMayEditAllDrafts });

  /** Recomputes quality flags after an edit and stores them on the submission (if any). Never publishes. */
  async function refreshFlags(articleId: string, settings: AutomationSettings, droppedTags = 0): Promise<{ flags: DraftFlag[]; wouldPublish: boolean; publishReasons: string[] }> {
    const store = await import("@/content/automation.server");
    const submission = await store.findSubmission({ articleId });
    const sql = await getSql();
    const rows = await sql<{ title: string; status: string; category_id: string; cover_media_id: string | null; blocks: string }>`select title, status, category_id, cover_media_id, blocks from articles where id = ${articleId}`;
    const row = rows[0];
    if (!row) return { flags: [], wouldPublish: false, publishReasons: ["That article no longer exists."] };
    const blocks = JSON.parse(row.blocks ?? "[]") as ArticleBlock[];
    const dup = await sql<{ id: string }>`select id from articles where lower(title) = lower(${row.title}) and id <> ${articleId} limit 1`;
    const sourceUrls = submission?.sourceUrls ?? [];
    const flags = draftFlags({
      words: wordCount(stripSourcesSection(blocks)),
      sourceUrls,
      text: `${row.title}\n${JSON.stringify(blocks).slice(0, 20000)}`,
      policy: settings.policy,
      duplicateTitle: dup.length > 0,
      uncertain: (submission?.flags ?? []).includes("self_reported_uncertain"),
      hasImage: Boolean(row.cover_media_id),
      droppedTags,
    });
    // t72: keep the topic_review flag honest after edits (body/topics change).
    try {
      const topicIds = await topicIdsOf(articleId, row.category_id);
      const { categories: cats } = await taxonomy();
      const slugOf = (id: string) => cats.find((c) => c.id === id)?.slug ?? id;
      const text = blocks.map((b) => [("text" in b ? b.text : ""), ("heading" in b ? b.heading : ""), ...(Array.isArray(("items" in b ? b.items : undefined)) ? (b as { items: string[] }).items : [])].join(" ")).join("\n");
      const adv = topicSignals({ title: row.title, body: text }, topicIds.map(slugOf));
      if (adv.reviewNeeded && !flags.includes("topic_review")) flags.push("topic_review");
    } catch { /* advisory only */ }
    if (submission) await store.setSubmissionFlags(articleId, flags);
    if (row.status !== "draft") return { flags, wouldPublish: false, publishReasons: [`The article is ${row.status}; editing never changes its status.`] };
    const runUsage = effectiveRun(profileId, null, await store.aiPublishUsageToday(profileId));
    const decision = publishDecision({ active: automationActive(settings), policy: await decisionPolicy(settings), status: row.status, categoryIds: await topicIdsOf(articleId, row.category_id), flags, publishedThisRun: runUsage.used });
    return { flags, wouldPublish: decision.publish, publishReasons: decision.publish ? [] : decision.reasons };
  }

  async function refuse(tool: string, error: unknown, articleId?: string): Promise<ToolResult> {
    const message = error instanceof Error ? error.message : "That article is locked for AI editing.";
    const store = await import("@/content/automation.server");
    await store.recordRun({ profileId, tool, outcome: "refused", reason: message, articleId: articleId ?? null, auth });
    return { ok: false, error: message };
  }

  return [
    {
      name: "get_blog_settings",
      title: "Get blog settings",
      description:
        "Read the blog's identity, automation status (enabled/paused, provider), owner topic ideas and sources, the " +
        "publishing policy, and the existing categories and tags. Call this first.",
      inputSchema: schemaOf(z.object({})),
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: async () => {
        const settings = await loadSettings(profileId);
        const { readSettings } = await import("@/content/repository.server");
        const { site } = await readSettings();
        const tax = await taxonomy();
        const env = (await workerEnv()) as KeyEnv;
        return {
          ok: true,
          data: {
            site: { name: site.name, title: site.title, description: site.description, publisher: site.publisher },
            automation: {
              profile: { id: profileId, name: (await (await import("@/content/automation.server")).listProfiles()).find((p) => p.id === profileId)?.name ?? profileId },
              ...automationActive(settings),
              enabled: settings.enabled,
              paused: settings.paused,
              provider: providerStatus(settings, env),
              schedule: settings.schedule,
              nextExpectedRun: (await import("@/lib/automation/schedule")).nextExpectedRun(settings.schedule)?.toISOString() ?? null,
              scheduleNote: "This website has no scheduler. Run times are set in your AI app; nextExpectedRun is only the owner's configured expectation.",
              selection: computeTopicSelection(settings.topicSelection, settings.topicIdeas, await (await import("@/content/automation.server")).readTopicCursor(profileId)),
              topicIdeas: settings.topicIdeas,
              topicSources: settings.topicSources,
              publishingPolicy: settings.policy,
              imageTransfer: settings.imageTransfer,
              draftEditing: {
                mayEditAllDrafts: settings.aiMayEditAllDrafts,
                rules:
                  "AI may fully edit draft/unpublished articles it created (list_editable_articles). The master token may edit any draft. " +
                  "publish_article_if_allowed is an EXPLICIT publish: it always publishes a draft you may edit, ignoring the publishing " +
                  "policy (cap, topics, flags, auto-publish off) and returning those as warnings — policy only governs AUTOMATIC " +
                  "publishing during submit/cover flows. Published articles are locked unless the owner enables 'Allow AI to edit " +
                  "this article' for that article in the admin panel; even then AI can never delete it or change its status, and " +
                  "there is no AI unpublish.",
              },
            },
            ...tax,
            topics: tax.categories.map((c) => ({ slug: c.slug, label: c.label, description: c.description, fileWhen: filingGuidance(c.slug, c.description) })),
            topicInstructions:
              "File every article under the blog's topics BY ITS ACTUAL CONTENT (each topic below has a `fileWhen` line — use it). " +
              "In submit_article_draft pass `topics`: " + `1 to ${MAX_TOPICS_PER_ARTICLE} entries (slug or exact name), best fit first: THE FIRST IS THE MAIN TOPIC = the article's main subject — not a default. ` +
              "Anti-rote rules: (1) Never default to artificial-intelligence-ai-tools or tech-news just because the blog covers tech or an AI lab is mentioned — ask 'what is this article mainly about?' (2) File under every topic that genuinely fits (usually 2–4): subject + company/industry + business angle. " +
              "A quantum-computing result is emerging-technology (+ robotics-science, big-tech-companies), NOT AI. A robot foundation model is robotics-science + AI. Chip-company earnings are chips-gaming + funding-tech-business. A phone review is product-reviews + smartphones + buying-guides. " +
              "(3) tech-news is a last resort only, never the sole topic when a subject topic fits. (4) The order of the `topics` list here is NOT a priority order. " +
              "The server checks content signals: a single-topic filing whose text strongly signals other topics is flagged topic_review, will not auto-publish, and the submit reply's `topic_advice.suggested_missing` names the likely topics — re-file with update_article_draft if they fit. Unknown topics are rejected with the valid list. The legacy single `category` field still works and is merged into `topics`. " +
              "To change topics later use update_article_draft with `topics`, `add_topics` or `remove_topics`.",
            limits: { maxBodyChars: MAX_BODY_CHARS, maxImageBytes: MAX_IMAGE_BYTES, imageTypes: ["image/jpeg", "image/png", "image/webp"] },
          },
        };
      },
    },
    {
      name: "list_recent_articles",
      title: "List recent articles",
      description:
        "List recent articles (newest first) with title, slug, status, dates, category and, for automated pieces, the " +
        "source URLs used. Use it to avoid repeating topics or sources.",
      inputSchema: schemaOf(listSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: async (args) => {
        const parsed = listSchema.safeParse(args ?? {});
        if (!parsed.success) return invalid(parsed.error);
        const { ensureContent } = await import("@/content/repository.server");
        await ensureContent();
        const sql = await getSql();
        const limit = parsed.data.limit ?? 20;
        const rows = parsed.data.status
          ? await sql<Record<string, string>>`select a.id, a.slug, a.title, a.excerpt, a.status, a.published_at, a.updated_at,
              c.label as category, s.source_urls from articles a left join categories c on c.id = a.category_id
              left join automation_submissions s on s.article_id = a.id
              where a.status = ${parsed.data.status} order by a.updated_at desc limit ${limit}`
          : await sql<Record<string, string>>`select a.id, a.slug, a.title, a.excerpt, a.status, a.published_at, a.updated_at,
              c.label as category, s.source_urls from articles a left join categories c on c.id = a.category_id
              left join automation_submissions s on s.article_id = a.id
              order by a.updated_at desc limit ${limit}`;
        const topicLabels = await topicLabelsOf(rows.map((r) => r.id));
        return {
          ok: true,
          data: {
            articles: rows.map((r) => ({
              id: r.id,
              slug: r.slug,
              title: r.title,
              excerpt: r.excerpt,
              status: r.status,
              publishedAt: r.published_at,
              updatedAt: r.updated_at,
              category: r.category,
              topics: topicLabels.get(r.id) ?? (r.category ? [r.category] : []),
              path: r.status === "published" ? `/articles/${r.slug}` : null,
              automated: r.source_urls != null,
              sourceUrls: r.source_urls ? JSON.parse(r.source_urls) : [],
            })),
          },
        };
      },
    },
    {
      name: "submit_article_draft",
      title: "Submit article draft",
      description:
        "Create a DRAFT article. Validated and idempotent: the same idempotency_key (or identical content) returns the " +
        "existing draft instead of a duplicate. Quality flags are returned; flagged pieces always stay drafts.",
      inputSchema: schemaOf(submitSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      run: async (args) => {
        const parsed = submitSchema.safeParse(args ?? {});
        if (!parsed.success) return invalid(parsed.error);
        const input = parsed.data;
        const settings = await loadSettings(profileId);
        const blocked = await writeGate(settings);
        const store = await import("@/content/automation.server");
        if (blocked) {
          await store.recordRun({ profileId, tool: "submit_article_draft", outcome: "refused", reason: blocked, auth });
          return { ok: false, error: blocked };
        }
        const prior = await store.findSubmission({ key: input.idempotency_key });
        const hash = await contentHash(input.title, input.body);
        const twin = prior ?? (await store.findSubmission({ hash }));
        if (twin) {
          return {
            ok: true,
            data: { duplicate: true, matchedBy: prior ? "idempotency_key" : "content_hash", article_id: twin.articleId, flags: twin.flags, status: "unchanged" },
          };
        }
        const { categories, tags } = await taxonomy();
        const merged = mergeTopicRefs({ topics: input.topics, category: input.category }, categories);
        if (merged.unknown.length > 0) {
          return { ok: false, error: unknownTopicsError(merged.unknown, categories), data: { valid_topics: categories.map((c) => c.slug) } };
        }
        if (merged.ids.length === 0) {
          return { ok: false, error: "No topic given. " + unknownTopicsError(["(none)"], categories), data: { valid_topics: categories.map((c) => c.slug) } };
        }
        if (merged.ids.length > MAX_TOPICS_PER_ARTICLE) {
          return { ok: false, error: `Too many topics (${merged.ids.length}). Pick at most ${MAX_TOPICS_PER_ARTICLE} that fit the article's actual content.`, data: { valid_topics: categories.map((c) => c.slug) } };
        }
        const topicIds = merged.ids;
        const category = categories.find((c) => c.id === topicIds[0]) ?? categories[0];
        const tagIds: string[] = [];
        let dropped = 0;
        for (const ref of input.tags ?? []) {
          const tag = pick(tags, ref);
          if (tag && !tagIds.includes(tag.id)) tagIds.push(tag.id);
          else if (!tag) dropped += 1;
        }
        const { valid: sources } = sourceProblems(input.source_urls);
        const bodyBlocks = bodyToBlocks(input.body);
        if (bodyBlocks.length === 0) return { ok: false, error: "The body is empty." };
        const blocks = [...bodyBlocks, ...sourcesBlocks(sources)];
        if (blocks.length > 80) return { ok: false, error: "The body has too many blocks (max 78 plus sources)." };
        const sql = await getSql();
        const sameTitle = await sql<{ id: string }>`select id from articles where lower(title) = lower(${input.title}) limit 1`;
        const flags: DraftFlag[] = draftFlags({
          words: wordCount(bodyBlocks),
          sourceUrls: input.source_urls,
          text: `${input.title}\n${input.excerpt}\n${input.body}`,
          policy: settings.policy,
          duplicateTitle: sameTitle.length > 0,
          uncertain: input.uncertain ?? false,
          hasImage: Boolean(input.cover_media_id),
          droppedTags: dropped,
        });
        // t72: deterministic content signals — advisory only, never auto-assign.
        // A single-topic filing whose content strongly signals other topics is
        // flagged topic_review (keeps it a draft for the owner to check).
        const advice = topicSignals({ title: input.title, excerpt: input.excerpt, body: input.body }, topicIds.map((id) => categories.find((c) => c.id === id)?.slug ?? id));
        if (advice.reviewNeeded && !flags.includes("topic_review")) flags.push("topic_review");
        const { saveArticle, deleteDraft, ContentError } = await import("@/content/repository.server");
        let saved: { id: string; slug: string };
        try {
          saved = await saveArticle({
            id: null,
            title: input.title,
            slug: input.slug ?? "",
            excerpt: input.excerpt,
            categoryId: category.id,
            topicIds,
            tagIds,
            motif: MOTIFS[parseInt(hash.slice(0, 2), 16) % MOTIFS.length],
            featured: false,
            seoTitle: input.seo_title ?? "",
            seoDescription: input.seo_description ?? "",
            coverMediaId: input.cover_media_id ?? null,
            publishedAt: null,
            blocks,
            intent: "save",
          });
        } catch (error) {
          if (error instanceof ContentError || error instanceof z.ZodError) {
            const message = error instanceof z.ZodError ? "The article failed validation." : error.message;
            await store.recordRun({ profileId, tool: "submit_article_draft", outcome: "rejected", reason: message, auth });
            return { ok: false, error: message };
          }
          throw error;
        }
        const winner = await store.claimSubmission({
          idempotencyKey: input.idempotency_key,
          contentHash: hash,
          articleId: saved.id,
          sourceUrls: sources,
          flags,
          provider: auth,
          profileId,
          createdAt: new Date().toISOString(),
        });
        if (winner.articleId !== saved.id) {
          await deleteDraft(saved.id); // lost a concurrent retry race: keep the first draft only
          return { ok: true, data: { duplicate: true, matchedBy: "idempotency_key", article_id: winner.articleId, flags: winner.flags, status: "unchanged" } };
        }
        await store.recordRun({ profileId,
          tool: "submit_article_draft",
          outcome: "drafted",
          reason: flags.length ? `flags: ${flags.join(", ")}` : "",
          articleId: saved.id,
          auth,
          details: { notes: input.notes ?? "", sources: sources.length, selectionMode: settings.topicSelection.mode, topicIdeaUsed: input.topic_idea_used ?? (input.used_topic_index !== undefined ? settings.topicIdeas[input.used_topic_index] ?? null : null), usedTopicIndex: input.used_topic_index ?? null },
        });
        // Sequence mode: a real draft confirms usage — advance the cursor.
        let usedIndex: number | null = null;
        if (settings.topicSelection.mode === "sequence" && settings.topicIdeas.length) {
          const store2 = await import("@/content/automation.server");
          const cursor = await store2.readTopicCursor(profileId);
          const sel = computeTopicSelection(settings.topicSelection, settings.topicIdeas, cursor);
          usedIndex = input.used_topic_index !== undefined && settings.topicIdeas[input.used_topic_index] !== undefined
            ? input.used_topic_index
            : input.topic_idea_used && settings.topicIdeas.includes(input.topic_idea_used)
              ? settings.topicIdeas.indexOf(input.topic_idea_used)
              : sel.suggestedIndex;
          if (usedIndex !== null) await store2.writeTopicCursor(profileId, advanceCursor(usedIndex, settings.topicSelection.step, settings.topicIdeas.length));
        }
        const auto = await attemptAutoPublish(saved.id, profileId, auth, input.run_id);
        return {
          ok: true,
          data: {
            duplicate: false,
            article_id: saved.id,
            slug: saved.slug,
            topics: topicIds.map((id) => categories.find((c) => c.id === id)?.slug ?? id),
            topic_advice: {
              filed: topicIds.map((id) => categories.find((c) => c.id === id)?.slug ?? id),
              suggested_missing: advice.suggestedMissing.map((m) => ({ slug: m.slug, label: categories.find((c) => c.slug === m.slug)?.label ?? m.slug, signals: m.matched })),
              review_needed: advice.reviewNeeded,
              note: advice.reviewNeeded
                ? "Filed under a single topic but the content strongly signals the suggested topic(s). This draft is flagged topic_review and will not auto-publish. Re-file by content with update_article_draft (topics, best fit first) if the suggestions fit — the first topic is the main subject, not a default."
                : advice.suggestedMissing.length
                  ? "The content also signals the suggested topic(s). Consider adding any that genuinely fit (max 4 total) with update_article_draft add_topics."
                  : "No missing-topic signals detected.",
            },
            category: category.slug,
            status: auto.published ? "published" : "draft",
            published: auto.published,
            publish_reasons: auto.reasons,
            flags,
            topic_selection: { mode: settings.topicSelection.mode, used_index: usedIndex },
            preview_path: `/preview/${saved.id}`,
            admin_path: `/admin/articles/${saved.id}`,
          },
        };
      },
    },
    {
      name: "publish_article_if_allowed",
      title: "Publish a draft now (explicit)",
      description:
        "EXPLICIT publish: publish a draft/unpublished article NOW, on your deliberate instruction. This works " +
        "for drafts your profile may edit (your own drafts; the master token: any draft) — the publishing POLICY " +
        "(allowed topics, quality flags, auto-publish on/off, featured-image rule) does NOT block an explicit " +
        "publish; it only governs AUTOMATIC publishing during submit_article_draft / cover attach. The owner's " +
        "HARD limits DO block it: the whole-website daily AI publish cap (Settings) and the per-run cap " +
        "(Automation tab) count every AI publish, automatic or explicit. Policy items that " +
        "would have failed are returned as `warnings` for transparency. Once published, the article is locked: AI " +
        "cannot edit (without the owner's per-article grant), unpublish, delete or re-publish it — only the owner " +
        "controls it in the admin panel. There is deliberately no AI unpublish.",
      inputSchema: schemaOf(publishSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      run: async (args) => {
        const parsed = publishSchema.safeParse(args ?? {});
        if (!parsed.success) return invalid(parsed.error);
        const result = await explicitPublish(parsed.data.article_id, profileId, auth, parsed.data.run_id);
        if (result.status === "missing") return { ok: false, error: "That article no longer exists." };
        if (result.status === "blocked") return { ok: false, error: result.reasons[0] };
        if (!result.published && !result.alreadyPublished) return { ok: false, error: result.reasons[0] ?? "Your profile cannot publish that draft." };
        return {
          ok: true,
          data: {
            published: result.published,
            status: result.status,
            mode: "explicit",
            ...(result.alreadyPublished ? { already_published: true, reasons: result.reasons } : {}),
            ...(result.published ? { warnings: result.warnings, path: `/articles/${result.slug ?? ""}` } : {}),
          },
        };
      },
    },
    {
      name: "upload_featured_image",
      title: "Upload featured image",
      description:
        "Store a featured image in the blog's media library (R2) and optionally attach it to an automation draft. " +
        "Accepts real JPEG/PNG/WebP bytes as base64, or a public https URL (no private hosts/IPs, max 10 MB, at least 400x200 px). " +
        "If you cannot create an image, pass the direct https URL of a relevant, properly licensed image (Wikimedia Commons, " +
        "Unsplash, Pexels, or the publisher's own press image) and fill credit + source_page. The credit is added to the draft.",
      inputSchema: schemaOf(imageSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      run: async (args) => {
        const parsed = imageSchema.safeParse(args ?? {});
        if (!parsed.success) return invalid(parsed.error);
        const input = parsed.data;
        const settings = await loadSettings(profileId);
        const store = await import("@/content/automation.server");
        const blocked = await writeGate(settings);
        if (blocked) {
          await store.recordRun({ profileId, tool: "upload_featured_image", outcome: "refused", reason: blocked, auth });
          return { ok: false, error: blocked };
        }
        let submission = null;
        if (input.article_id) {
          submission = await store.findSubmission({ articleId: input.article_id });
          if (!submission) return { ok: false, error: "Images can only be attached to drafts created by automation." };
          if ((submission.profileId ?? "default") !== profileId && profileId !== "default" && !settings.aiMayEditAllDrafts) {
            return { ok: false, error: "That draft was created by a different automation profile; only that profile (or the owner) can change its cover. Use set_article_cover on your own drafts." };
          }
        }
        let image: { bytes: Uint8Array; mime: string };
        try {
          image = input.image_base64 ? decodeBase64Image(input.image_base64) : await fetchImage(input.url as string);
          assertUsableCover(image.bytes, image.mime as ImageMime);
        } catch (error) {
          const message = error instanceof ImageIntakeError ? error.message : "Image could not be read.";
          await store.recordRun({ profileId, tool: "upload_featured_image", outcome: "rejected", reason: message, articleId: input.article_id, auth });
          return { ok: false, error: message };
        }
        const ext = image.mime.split("/")[1];
        const filename = (input.filename || `featured.${ext}`).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120);
        // Same unified pipeline as admin uploads (t60): validated,
        // optimized once via the IMAGES binding, stored as variants.
        const { uploadMediaBytes } = await import("@/content/repository.server");
        let uploaded: Awaited<ReturnType<typeof uploadMediaBytes>>;
        try {
          uploaded = await uploadMediaBytes({ filename, mime: image.mime, alt: input.alt, bytes: image.bytes });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Image could not be stored.";
          await store.recordRun({ profileId, tool: "upload_featured_image", outcome: "rejected", reason: message, articleId: input.article_id, auth });
          return { ok: false, error: message };
        }
        const mediaId = uploaded.id;
        let attached = false;
        if (submission && input.article_id) {
          const sql = await getSql();
          await sql`update articles set cover_media_id = ${mediaId}, updated_at = ${new Date().toISOString()}
            where id = ${input.article_id} and status = 'draft'`;
          const check = await sql<{ cover_media_id: string | null }>`select cover_media_id from articles where id = ${input.article_id}`;
          attached = check[0]?.cover_media_id === mediaId;
          if (attached) await store.setSubmissionFlags(input.article_id, submission.flags.filter((f) => f !== "needs_featured_image"));
          if (attached && input.credit) {
            const rows = await sql<{ blocks: string }>`select blocks from articles where id = ${input.article_id}`;
            const blocks = JSON.parse(rows[0]?.blocks ?? "[]") as { type: string; text?: string }[];
            const line = `Cover image: ${input.credit}${input.source_page ? ` (${input.source_page})` : ""}`;
            const kept = blocks.filter((b) => !(b.type === "paragraph" && typeof b.text === "string" && b.text.startsWith("Cover image: ")));
            // Credit goes before the "Sources" section, not inside it.
            const sources = kept.findIndex((b) => b.type === "heading" && b.text === "Sources");
            kept.splice(sources === -1 ? kept.length : sources, 0, { type: "paragraph", text: line });
            await sql`update articles set blocks = ${JSON.stringify(kept)} where id = ${input.article_id} and status = 'draft'`;
          }
        }
        await store.recordRun({ profileId, tool: "upload_featured_image", outcome: "stored", articleId: input.article_id ?? null, auth, details: { mediaId, bytes: image.bytes.length, mime: image.mime, attached, credit: input.credit ?? null, sourcePage: input.source_page ?? null } });
        const auto = attached && input.article_id ? await attemptAutoPublish(input.article_id, profileId, auth, input.run_id) : null;
        const note = input.article_id && !attached
          ? submission
            ? "Stored in the media library but not attached: the article is no longer a draft (the owner may have published it). Attach it in the admin panel."
            : "Stored in the media library but not attached: only drafts created by automation can get a cover this way."
          : undefined;
        return { ok: true, data: { media_id: mediaId, mime: image.mime, bytes: image.bytes.length, attached, path: `/media/${mediaId}`, hero_bytes: uploaded.image.heroBytes, thumb_bytes: uploaded.image.thumbBytes, width: uploaded.image.width, height: uploaded.image.height, processing: uploaded.image.processing, ...(uploaded.image.warnings.length ? { warnings: uploaded.image.warnings } : {}), ...(auto ? { published: auto.published, publish_reasons: auto.reasons, status: auto.status } : {}), ...(note ? { note } : {}) } };
      },
    },
    {
      name: "list_editable_articles",
      title: "List articles AI may edit",
      description:
        "List drafts/unpublished articles YOUR profile may edit (your own drafts; the master token sees all drafts; " +
        "other profiles' drafts appear only if the owner enabled 'AI may edit drafts created by other automations'). " +
        "Published articles are never listed — they are locked unless the owner grants one article in the admin panel.",
      inputSchema: schemaOf(listEditableSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: async (args) => {
        const parsed = listEditableSchema.safeParse(args ?? {});
        if (!parsed.success) return invalid(parsed.error);
        const settings = await loadSettings(profileId);
        const actor = actorFor(settings);
        const sql = await getSql();
        const rows = await sql<{ id: string; slug: string; title: string; status: string; updated_at: string; category: string | null; cover: string | null; owner: string | null; has_sub: number; flags: string | null }>`
          select a.id, a.slug, a.title, a.status, a.updated_at, c.label as category, a.cover_media_id as cover,
            s.profile_id as owner, (s.article_id is not null) as has_sub, s.flags as flags
          from articles a left join categories c on c.id = a.category_id
          left join automation_submissions s on s.article_id = a.id
          where a.status in ('draft', 'unpublished') order by a.updated_at desc limit 200`;
        const { assertAiCanAccess } = await import("@/lib/automation/ai-edit");
        const editable = rows
          .filter((r) => {
            try {
              assertAiCanAccess({ status: r.status as "draft" | "unpublished", slug: r.slug }, r.has_sub ? (r.owner ?? "default") : null, actor, "read");
              return true;
            } catch {
              return false;
            }
          })
          .slice(0, parsed.data.limit ?? 20);
        const topicLabels = await topicLabelsOf(editable.map((r) => r.id));
        return {
          ok: true,
          data: {
            articles: editable.map((r) => ({
              article_id: r.id, slug: r.slug, title: r.title, status: r.status, updatedAt: r.updated_at,
              category: r.category, topics: topicLabels.get(r.id) ?? (r.category ? [r.category] : []), hasCover: Boolean(r.cover), createdBy: r.has_sub ? (r.owner ?? "default") : "owner",
              flags: r.flags ? (JSON.parse(r.flags) as string[]) : [],
            })),
            rules: "Drafts/unpublished only. Published articles are locked unless the owner enables 'Allow AI to edit this article' for that one article in the admin panel.",
          },
        };
      },
    },
    {
      name: "get_article",
      title: "Get an editable article in full",
      description:
        "Full content of a draft/unpublished article you may edit: body (markdown + structured blocks), category, tags, " +
        "cover media id, SEO, source URLs and quality flags. Published articles return a locked error unless the owner " +
        "enabled 'Allow AI to edit this article' for that article in the admin panel.",
      inputSchema: schemaOf(getArticleSchema),
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: async (args) => {
        const parsed = getArticleSchema.safeParse(args ?? {});
        if (!parsed.success) return invalid(parsed.error);
        const settings = await loadSettings(profileId);
        try {
          const repo = await import("@/content/repository.server");
          const { article, ownerProfileId, viaGrant } = await repo.getArticleForAi(parsed.data.article_id, actorFor(settings), "read");
          const { categories, tags } = await taxonomy();
          const store = await import("@/content/automation.server");
          const submission = await store.findSubmission({ articleId: article.id });
          await store.recordRun({ profileId, tool: "get_article", outcome: "read", articleId: article.id, auth });
          return {
            ok: true,
            data: {
              article_id: article.id, slug: article.slug, title: article.title, excerpt: article.excerpt,
              status: article.status, publishedAt: article.publishedAt, updatedAt: article.updatedAt,
              category: pick(categories, article.categoryId) ?? { id: article.categoryId },
              topics: article.topicIds.map((id) => pick(categories, id) ?? { id }),
              tags: article.tagIds.map((id) => tags.find((t) => t.id === id) ?? { id }),
              coverMediaId: article.coverMediaId ?? null,
              seoTitle: article.seoTitle ?? "", seoDescription: article.seoDescription ?? "",
              body: blocksToBody(stripSourcesSection(article.blocks)),
              blocks: article.blocks,
              sourceUrls: submission?.sourceUrls ?? [],
              flags: submission?.flags ?? [],
              createdBy: ownerProfileId ?? "owner",
              aiEditGrant: viaGrant,
            },
          };
        } catch (error) {
          return refuse("get_article", error, parsed.data.article_id);
        }
      },
    },
    {
      name: "update_article_draft",
      title: "Edit a draft article",
      description:
        "Partially edit a draft/unpublished article (title, slug, excerpt, body, category, tags set/add/remove, SEO, " +
        "source URLs). Only fields you pass change; id and status are always preserved and editing NEVER publishes — " +
        "after editing, call publish_article_if_allowed if the refreshed flags and policy allow it. Published articles " +
        "are locked unless the owner enabled 'Allow AI to edit this article' (then status/slug changes stay forbidden).",
      inputSchema: schemaOf(updateDraftSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      run: async (args) => {
        const parsed = updateDraftSchema.safeParse(args ?? {});
        if (!parsed.success) return invalid(parsed.error);
        const input = parsed.data;
        const settings = await loadSettings(profileId);
        const store = await import("@/content/automation.server");
        const blocked = await writeGate(settings);
        if (blocked) {
          await store.recordRun({ profileId, tool: "update_article_draft", outcome: "refused", reason: blocked, articleId: input.article_id, auth });
          return { ok: false, error: blocked };
        }
        try {
          const repo = await import("@/content/repository.server");
          const actor = actorFor(settings);
          const { article: current } = await repo.getArticleForAi(input.article_id, actor, "edit");
          const { categories, tags } = await taxonomy();
          const patch: import("@/content/repository.server").AiArticlePatch = {};
          if (input.title !== undefined) patch.title = input.title;
          if (input.slug !== undefined) patch.slug = input.slug;
          if (input.excerpt !== undefined) patch.excerpt = input.excerpt;
          if (input.seo_title !== undefined) patch.seoTitle = input.seo_title;
          if (input.seo_description !== undefined) patch.seoDescription = input.seo_description;
          if (input.category !== undefined && input.topics === undefined && input.add_topics === undefined && input.remove_topics === undefined) {
            const category = pick(categories, input.category);
            if (!category) return { ok: false, error: unknownTopicsError([input.category], categories), data: { valid_topics: categories.map((c) => c.slug) } };
            patch.topicIds = [category.id];
          }
          if (input.topics !== undefined || input.add_topics !== undefined || input.remove_topics !== undefined || (input.category !== undefined && input.topics !== undefined)) {
            let next: string[];
            if (input.topics !== undefined) {
              const resolved = resolveTopicRefs(input.topics, categories);
              if (resolved.unknown.length > 0) return { ok: false, error: unknownTopicsError(resolved.unknown, categories), data: { valid_topics: categories.map((c) => c.slug) } };
              next = resolved.ids;
            } else {
              next = [...current.topicIds];
            }
            if (input.add_topics) {
              const resolved = resolveTopicRefs(input.add_topics, categories);
              if (resolved.unknown.length > 0) return { ok: false, error: unknownTopicsError(resolved.unknown, categories), data: { valid_topics: categories.map((c) => c.slug) } };
              for (const id of resolved.ids) if (!next.includes(id)) next.push(id);
            }
            if (input.remove_topics) {
              const resolved = resolveTopicRefs(input.remove_topics, categories);
              if (resolved.unknown.length > 0) return { ok: false, error: unknownTopicsError(resolved.unknown, categories), data: { valid_topics: categories.map((c) => c.slug) } };
              next = next.filter((id) => !resolved.ids.includes(id));
            }
            if (next.length === 0) return { ok: false, error: "An article must keep at least one topic. Add another topic before removing the last one." };
            if (next.length > MAX_TOPICS_PER_ARTICLE) return { ok: false, error: `Too many topics (${next.length}). An article can have at most ${MAX_TOPICS_PER_ARTICLE}; remove one first.`, data: { valid_topics: categories.map((c) => c.slug) } };
            patch.topicIds = next;
          }
          let droppedTags = 0;
          const resolveRefs = (refs: string[]): string[] => {
            const ids: string[] = [];
            for (const ref of refs) {
              const tag = pick(tags, ref);
              if (tag) { if (!ids.includes(tag.id)) ids.push(tag.id); } else droppedTags += 1;
            }
            return ids;
          };
          if (input.tags !== undefined || input.add_tags !== undefined || input.remove_tags !== undefined) {
            let next = input.tags !== undefined ? resolveRefs(input.tags) : [...current.tagIds];
            if (input.add_tags) for (const id of resolveRefs(input.add_tags)) if (!next.includes(id)) next.push(id);
            if (input.remove_tags) { const drop = new Set(resolveRefs(input.remove_tags)); next = next.filter((id) => !drop.has(id)); }
            patch.tagIds = next.slice(0, 24);
          }
          const submission = await store.findSubmission({ articleId: input.article_id });
          const effectiveSources = input.source_urls ?? submission?.sourceUrls ?? [];
          const { valid: validSources } = sourceProblems(effectiveSources);
          if (input.body !== undefined) {
            const bodyBlocks = bodyToBlocks(input.body);
            if (bodyBlocks.length === 0) return { ok: false, error: "The body is empty." };
            const blocks = [...bodyBlocks, ...sourcesBlocks(validSources)];
            if (blocks.length > 80) return { ok: false, error: "The body has too many blocks (max 78 plus sources)." };
            patch.blocks = blocks;
          } else if (input.source_urls !== undefined) {
            patch.blocks = [...stripSourcesSection(current.blocks), ...sourcesBlocks(validSources)];
          }
          const { updated, viaGrant } = await repo.updateArticleForAi(input.article_id, patch, actor);
          if (submission && input.source_urls !== undefined) await store.updateSubmissionSources(input.article_id, validSources);
          const { flags, wouldPublish, publishReasons } = await refreshFlags(input.article_id, settings, droppedTags);
          const changed = Object.keys(input).filter((k) => k !== "article_id");
          await store.recordRun({ profileId, tool: "update_article_draft", outcome: "updated", articleId: input.article_id, auth, details: { changed, flags, viaGrant } });
          return {
            ok: true,
            data: {
              article_id: updated.id, slug: updated.slug, status: updated.status, updatedAt: updated.updatedAt,
              topics: updated.topicIds.map((id) => categories.find((c) => c.id === id)?.slug ?? id),
              changed, flags, would_publish: updated.status === "draft" ? wouldPublish : false, publish_reasons: publishReasons, aiEditGrant: viaGrant,
              note: updated.status === "draft" ? "Still a draft. Editing never publishes — call publish_article_if_allowed to publish when policy allows." : "Published article edited under the owner's grant; its status did not change.",
            },
          };
        } catch (error) {
          return refuse("update_article_draft", error, input.article_id);
        }
      },
    },
    {
      name: "set_article_cover",
      title: "Set a draft's cover image",
      description:
        "Attach an existing media-library image as the cover of a draft/unpublished article you may edit (or a published " +
        "article the owner granted you). To upload a NEW image instead, use upload_featured_image, then set_article_cover " +
        "with the returned media_id. Setting a cover never publishes the article.",
      inputSchema: schemaOf(setCoverSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      run: async (args) => {
        const parsed = setCoverSchema.safeParse(args ?? {});
        if (!parsed.success) return invalid(parsed.error);
        const settings = await loadSettings(profileId);
        const store = await import("@/content/automation.server");
        const blocked = await writeGate(settings);
        if (blocked) {
          await store.recordRun({ profileId, tool: "set_article_cover", outcome: "refused", reason: blocked, articleId: parsed.data.article_id, auth });
          return { ok: false, error: blocked };
        }
        try {
          const repo = await import("@/content/repository.server");
          const { updated } = await repo.updateArticleForAi(parsed.data.article_id, { coverMediaId: parsed.data.media_id }, actorFor(settings));
          const { flags, publishReasons } = await refreshFlags(parsed.data.article_id, settings);
          await store.recordRun({ profileId, tool: "set_article_cover", outcome: "cover_set", articleId: parsed.data.article_id, auth, details: { mediaId: parsed.data.media_id } });
          return { ok: true, data: { article_id: updated.id, slug: updated.slug, status: updated.status, coverMediaId: parsed.data.media_id, flags, publish_reasons: publishReasons, note: "Cover set. The article was not published." } };
        } catch (error) {
          return refuse("set_article_cover", error, parsed.data.article_id);
        }
      },
    },
    {
      name: "remove_article_cover",
      title: "Remove a draft's cover image",
      description: "Clear the cover of an article you may edit. The image file stays in the media library; only the cover link is removed. Never publishes.",
      inputSchema: schemaOf(removeCoverSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      run: async (args) => {
        const parsed = removeCoverSchema.safeParse(args ?? {});
        if (!parsed.success) return invalid(parsed.error);
        const settings = await loadSettings(profileId);
        const store = await import("@/content/automation.server");
        const blocked = await writeGate(settings);
        if (blocked) {
          await store.recordRun({ profileId, tool: "remove_article_cover", outcome: "refused", reason: blocked, articleId: parsed.data.article_id, auth });
          return { ok: false, error: blocked };
        }
        try {
          const repo = await import("@/content/repository.server");
          const { updated } = await repo.updateArticleForAi(parsed.data.article_id, { coverMediaId: null }, actorFor(settings));
          const { flags, publishReasons } = await refreshFlags(parsed.data.article_id, settings);
          await store.recordRun({ profileId, tool: "remove_article_cover", outcome: "cover_removed", articleId: parsed.data.article_id, auth });
          return { ok: true, data: { article_id: updated.id, slug: updated.slug, status: updated.status, coverMediaId: null, flags, publish_reasons: publishReasons } };
        } catch (error) {
          return refuse("remove_article_cover", error, parsed.data.article_id);
        }
      },
    },
    {
      name: "delete_article_draft",
      title: "Delete a draft article permanently",
      description:
        "Hard-delete a draft/unpublished article you may edit. Permanent: requires confirm:true AND the article's exact " +
        "current slug echoed back. Tag links are removed; the cover image file is kept unless delete_cover_if_unused is " +
        "true (same rule as the admin panel). Published articles can NEVER be deleted by AI, even with an edit grant.",
      inputSchema: schemaOf(deleteDraftSchema),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      run: async (args) => {
        const parsed = deleteDraftSchema.safeParse(args ?? {});
        if (!parsed.success) return invalid(parsed.error);
        const input = parsed.data;
        const settings = await loadSettings(profileId);
        const store = await import("@/content/automation.server");
        const blocked = await writeGate(settings);
        if (blocked) {
          await store.recordRun({ profileId, tool: "delete_article_draft", outcome: "refused", reason: blocked, articleId: input.article_id, auth });
          return { ok: false, error: blocked };
        }
        try {
          const repo = await import("@/content/repository.server");
          const actor = actorFor(settings);
          const { article } = await repo.getArticleForAi(input.article_id, actor, "delete");
          if (input.slug !== article.slug) {
            await store.recordRun({ profileId, tool: "delete_article_draft", outcome: "refused", reason: "slug echo mismatch", articleId: input.article_id, auth });
            return { ok: false, error: `Confirmation slug does not match. The article's current slug is “${article.slug}”. Nothing was deleted.` };
          }
          const result = await repo.deleteArticleForAi(input.article_id, actor, { deleteCoverIfUnused: input.delete_cover_if_unused ?? false });
          await store.recordRun({ profileId, tool: "delete_article_draft", outcome: "deleted", articleId: input.article_id, auth, details: { slug: result.slug, coverDeleted: result.coverDeleted } });
          return { ok: true, data: { deleted: true, article_id: input.article_id, slug: result.slug, cover_deleted: result.coverDeleted } };
        } catch (error) {
          return refuse("delete_article_draft", error, input.article_id);
        }
      },
    },
    {
      name: "record_run_result",
      title: "Record run result",
      description:
        "Record the outcome of an automation run, especially when skipping (nothing good enough, duplicate topic, " +
        "sources unverifiable). Works even when automation is disabled or paused.",
      inputSchema: schemaOf(runSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      run: async (args) => {
        const parsed = runSchema.safeParse(args ?? {});
        if (!parsed.success) return invalid(parsed.error);
        const store = await import("@/content/automation.server");
        const id = await store.recordRun({ profileId,
          tool: "record_run_result",
          outcome: parsed.data.outcome,
          reason: parsed.data.reason,
          articleId: parsed.data.article_id ?? null,
          auth,
          details: { topic: parsed.data.topic ?? "", selectionMode: (await loadSettings(profileId)).topicSelection.mode, topicIdeaUsed: parsed.data.topic_idea_used ?? null, usedTopicIndex: parsed.data.used_topic_index ?? null },
        });
        return id ? { ok: true, data: { recorded: true, run_id: id } } : { ok: false, error: "Could not record the run." };
      },
    },
  ];
}
