import type { KeyEnv } from "@/lib/automation/provider";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { workerEnv } from "@/lib/cf-env.server";
import { writesAllowed } from "@/lib/write-guard.server";
import { automationActive, type AutomationSettings } from "@/lib/automation/settings";
import { bodyToBlocks, contentHash, wordCount } from "@/lib/automation/body";
import { draftFlags, publishDecision, sourceProblems, type DraftFlag } from "@/lib/automation/policy";
import { assertUsableCover, decodeBase64Image, fetchImage, ImageIntakeError, MAX_IMAGE_BYTES, type ImageMime } from "@/lib/automation/image-fetch";
import { providerStatus } from "@/lib/automation/provider";
import type { ToolDefinition, ToolResult } from "./protocol";
import type { ArticleBlock, CoverMotif } from "@/content/types";

/**
 * The six automation tools. Each one authorises against the owner's automation
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
  category: z.string().trim().min(1).max(80).describe("Existing category id, slug or label (see get_blog_settings)."),
  tags: z.array(z.string().trim().min(1).max(80)).max(8).optional().describe("Existing tag ids/slugs/labels. Unknown tags are dropped."),
  seo_title: z.string().trim().max(200).optional(),
  seo_description: z.string().trim().max(300).optional(),
  source_urls: z.array(z.string().trim().max(500)).max(20).describe("https URLs of sources actually used. Never invent citations."),
  uncertain: z.boolean().optional().describe("Set true if any claim could not be verified; the piece will stay a draft."),
  notes: z.string().trim().max(1000).optional().describe("Notes for the editor (not published)."),
});

const listSchema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
  status: z.enum(["draft", "published", "unpublished"]).optional(),
});

const publishSchema = z.object({ article_id: articleIdSchema });

const imageSchema = z
  .object({
    article_id: articleIdSchema.optional().describe("Automation-created draft to attach the image to as its cover."),
    image_base64: z.string().max(2_100_000).optional().describe("JPEG/PNG/WebP bytes, base64 (max 1.5 MB decoded)."),
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
  })
  .refine((v) => Boolean(v.image_base64) !== Boolean(v.url), "Provide exactly one of image_base64 or url.");

const runSchema = z.object({
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

function pick<T extends { id: string; slug: string; label: string }>(items: T[], ref: string): T | undefined {
  const needle = ref.trim().toLowerCase();
  return items.find((i) => i.id.toLowerCase() === needle || i.slug === needle || i.label.toLowerCase() === needle);
}

function sourcesBlocks(urls: string[]): ArticleBlock[] {
  return urls.length ? [{ type: "heading", level: 2, text: "Sources" }, { type: "list", items: urls }] : [];
}

export function buildTools(ctx: Ctx): ToolDefinition[] {
  const { auth } = ctx;
  const profileId = ctx.profileId ?? "default";
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
              topicIdeas: settings.topicIdeas,
              topicSources: settings.topicSources,
              publishingPolicy: settings.policy,
              imageTransfer: settings.imageTransfer,
            },
            ...(await taxonomy()),
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
        const category = pick(categories, input.category);
        if (!category) {
          return { ok: false, error: "Unknown category. Use one of the existing categories.", data: categories.map((c) => c.slug) };
        }
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
          hasImage: false,
          droppedTags: dropped,
        });
        const { saveArticle, deleteDraft, ContentError } = await import("@/content/repository.server");
        let saved: { id: string; slug: string };
        try {
          saved = await saveArticle({
            id: null,
            title: input.title,
            slug: input.slug ?? "",
            excerpt: input.excerpt,
            categoryId: category.id,
            tagIds,
            motif: MOTIFS[parseInt(hash.slice(0, 2), 16) % MOTIFS.length],
            featured: false,
            seoTitle: input.seo_title ?? "",
            seoDescription: input.seo_description ?? "",
            coverMediaId: null,
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
          details: { notes: input.notes ?? "", sources: sources.length },
        });
        return {
          ok: true,
          data: {
            duplicate: false,
            article_id: saved.id,
            slug: saved.slug,
            status: "draft",
            flags,
            preview_path: `/preview/${saved.id}`,
            admin_path: `/admin/articles/${saved.id}`,
          },
        };
      },
    },
    {
      name: "publish_article_if_allowed",
      title: "Publish article if policy allows",
      description:
        "Publish an automation-created draft ONLY if the owner's publishing policy explicitly allows it (auto-publish " +
        "on, allowed category, no blocking flags, daily cap). Otherwise it stays a draft and the reasons are returned.",
      inputSchema: schemaOf(publishSchema),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      run: async (args) => {
        const parsed = publishSchema.safeParse(args ?? {});
        if (!parsed.success) return invalid(parsed.error);
        const store = await import("@/content/automation.server");
        const settings = await loadSettings(profileId);
        const submission = await store.findSubmission({ articleId: parsed.data.article_id });
        if (!submission) return { ok: false, error: "Only drafts created by automation can be published by automation." };
        if ((submission.profileId ?? "default") !== profileId) {
          return { ok: false, error: "That draft was created by a different automation profile; only that profile (or the owner) can publish it." };
        }
        const sql = await getSql();
        const rows = await sql<{ status: string; category_id: string; slug: string }>`
          select status, category_id, slug from articles where id = ${parsed.data.article_id}`;
        if (!rows[0]) return { ok: false, error: "That article no longer exists." };
        const decision = publishDecision({
          active: automationActive(settings),
          policy: settings.policy,
          status: rows[0].status,
          categoryId: rows[0].category_id,
          flags: submission.flags as DraftFlag[],
          publishedToday: await store.automatedPublishesToday(profileId),
        });
        if (decision.publish && !(await writesAllowed())) {
          return { ok: true, data: { published: false, status: rows[0].status, reasons: ["This deployment is read-only."] } };
        }
        if (!decision.publish) {
          await store.recordRun({ profileId, tool: "publish_article_if_allowed", outcome: "kept_draft", reason: decision.reasons.join(" "), articleId: parsed.data.article_id, auth });
          return { ok: true, data: { published: false, status: rows[0].status, reasons: decision.reasons } };
        }
        const now = new Date().toISOString();
        await sql`update articles set status = 'published', published_at = ${now}, updated_at = ${now}
          where id = ${parsed.data.article_id} and status = 'draft'`;
        await store.recordRun({ profileId, tool: "publish_article_if_allowed", outcome: "published", articleId: parsed.data.article_id, auth });
        return { ok: true, data: { published: true, status: "published", path: `/articles/${rows[0].slug}` } };
      },
    },
    {
      name: "upload_featured_image",
      title: "Upload featured image",
      description:
        "Store a featured image in the blog's media library (R2) and optionally attach it to an automation draft. " +
        "Accepts real JPEG/PNG/WebP bytes as base64, or a public https URL (no private hosts/IPs, max 1.5 MB, at least 400x200 px). " +
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
        let bin = "";
        for (const b of image.bytes) bin += String.fromCharCode(b);
        const ext = image.mime.split("/")[1];
        const filename = (input.filename || `featured.${ext}`).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120);
        const { uploadMedia } = await import("@/content/repository.server");
        const { id: mediaId } = await uploadMedia({ filename, mime: image.mime, alt: input.alt, dataBase64: btoa(bin) });
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
        const note = input.article_id && !attached
          ? submission
            ? "Stored in the media library but not attached: the article is no longer a draft (the owner may have published it). Attach it in the admin panel."
            : "Stored in the media library but not attached: only drafts created by automation can get a cover this way."
          : undefined;
        return { ok: true, data: { media_id: mediaId, mime: image.mime, bytes: image.bytes.length, attached, path: `/media/${mediaId}`, ...(note ? { note } : {}) } };
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
          details: { topic: parsed.data.topic ?? "" },
        });
        return id ? { ok: true, data: { recorded: true, run_id: id } } : { ok: false, error: "Could not record the run." };
      },
    },
  ];
}
