import { getSql } from "@/lib/db";
import type { PipelineDeps } from "./run.server";

/**
 * Production wiring for the run pipeline: the same repository functions the
 * desk and the MCP tools use, so an automated article is created, validated and
 * published through exactly one code path.
 */
export async function productionDeps(): Promise<PipelineDeps> {
  const {
    saveArticle,
    readSiteIdentity,
    attachCoverToDraft,
    publishDraftIfStillDraft,
    uploadMedia,
    ensureContent,
  } = await import("@/content/repository.server");
  const store = await import("./store.server");
  const submissions = await import("@/content/automation.server");

  return {
    fetch: (...args) => fetch(...args),
    recentTitles: (limit) => store.recentTitles(limit),
    runIndex: async (automationId) => (await store.runCounts(automationId)).total,
    categories: async () => {
      await ensureContent();
      const sql = await getSql();
      return sql<{ id: string; slug: string; label: string }>`select id, slug, label from categories order by label asc`;
    },
    tags: async () => {
      await ensureContent();
      const sql = await getSql();
      return sql<{ id: string; slug: string; label: string }>`select id, slug, label from tags order by label asc`;
    },
    siteIdentity: () => readSiteIdentity(),
    saveDraft: async (input) => {
      const saved = await saveArticle({
        id: null,
        title: input.title,
        slug: input.slug,
        excerpt: input.excerpt,
        categoryId: input.categoryId,
        tagIds: input.tagIds,
        motif: input.motif,
        featured: false,
        seoTitle: input.seoTitle,
        seoDescription: input.seoDescription,
        coverMediaId: null,
        publishedAt: null,
        blocks: input.blocks,
        intent: "save",
      });
      return { id: saved.id, slug: saved.slug };
    },
    uploadImage: async (input) => (await uploadMedia(input)).id,
    attachCover: async (articleId, mediaId) => {
      await attachCoverToDraft(articleId, mediaId);
    },
    publishDraft: (articleId) => publishDraftIfStillDraft(articleId),
    publishedToday: (automationId) => store.automatedPublishesToday(automationId),
    findDuplicate: async ({ key, hash }) => {
      const byKey = await submissions.findSubmission({ key });
      if (byKey) return { articleId: byKey.articleId, matchedBy: "run_key" as const };
      const byHash = await submissions.findSubmission({ hash });
      if (byHash) return { articleId: byHash.articleId, matchedBy: "content_hash" as const };
      return null;
    },
    claimRun: async ({ key, hash, articleId, sources, flags }) => {
      const winner = await submissions.claimSubmission({
        idempotencyKey: key,
        contentHash: hash,
        articleId,
        sourceUrls: sources,
        flags,
        provider: "server-api",
        createdAt: new Date().toISOString(),
      });
      return winner.articleId === articleId;
    },
    setFlags: (articleId, flags) => submissions.setSubmissionFlags(articleId, flags),
    log: async (run) => {
      await store.recordRun({
        automationId: run.automationId,
        tool: run.tool ?? "scheduled_run",
        outcome: run.outcome ?? run.status,
        status: run.status,
        stage: run.stage,
        reason: run.reason,
        articleId: run.articleId ?? null,
        auth: "scheduler",
        durationMs: run.durationMs,
        attempt: run.attempt,
        details: { ...(run.details ?? {}), flags: run.flags ?? [], published: run.published ?? false },
      });
    },
  };
}
