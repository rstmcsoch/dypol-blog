/**
 * Master MCP tool registry. Registered only after Master-specific
 * authentication. Every mutation authenticates (already done), validates
 * input, checks the permitted scope, uses existing domain services, audits
 * the result and returns structured JSON. There is no SQL/code passthrough.
 */
import { z } from "zod";
import type { ToolDefinition, ToolResult } from "./protocol";
import { MASTER_PERMISSION_SUMMARY, MASTER_PROHIBITED, MASTER_PROHIBITED_TOOL_NAMES, isMasterDenied, denyMaster } from "./master/permissions";
import { MASTER_TOOL_CATALOG } from "./master/catalog";
import { assertSitePatchAllowed, assertAdsPatchAllowed, collectAdsSnapshot } from "./master/settings-guard";
import type { MasterActor } from "@/content/master-mcp.server";
import type { PublishSource } from "@/lib/publish-source";
import { contrast, themeColors } from "@/lib/appearance";

export type MasterToolCtx = { actor: MasterActor; source: PublishSource | null };

const periodSchema = z.object({
  period: z.enum(["today", "yesterday", "last-7", "last-28", "last-30", "last-90", "last-12-months", "custom"]).optional(),
  from: z.string().trim().max(20).optional(),
  to: z.string().trim().max(20).optional(),
}).optional();

function invalid(error: z.ZodError): ToolResult {
  return { ok: false, error: "Invalid input.", data: error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })) };
}

function fail(error: unknown): ToolResult {
  if (isMasterDenied(error)) return { ok: false, error: (error as Error).message };
  return { ok: false, error: error instanceof Error ? error.message : "The tool failed on the server." };
}

function schemaOf(schema: z.ZodType): Record<string, unknown> {
  return { type: "object", additionalProperties: true, description: "See tool description for fields." };
}

async function audit(ctx: MasterToolCtx, toolName: string, action: string, extra: {
  resourceType?: string; resourceId?: string; before?: unknown; after?: unknown; success: boolean; error?: string;
  relatedArticleId?: string; relatedProfileId?: string; relatedTaskId?: string;
}) {
  const { recordMasterAudit } = await import("@/content/master-mcp.server");
  await recordMasterAudit({ actor: ctx.actor, toolName, action, ...extra });
}

function tool<S extends z.ZodType>(def: {
  name: string;
  title: string;
  description: string;
  schema: S;
  hints?: ToolDefinition["annotations"];
  resourceType?: string;
  action?: string;
  run: (input: z.infer<S>, ctx: MasterToolCtx) => Promise<unknown>;
}): (ctx: MasterToolCtx) => ToolDefinition {
  return (ctx) => ({
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: schemaOf(def.schema),
    annotations: { openWorldHint: false, ...def.hints },
    run: async (args) => {
      if ((MASTER_PROHIBITED_TOOL_NAMES as readonly string[]).includes(def.name)) {
        denyMaster(def.name in MASTER_PROHIBITED ? def.name : "execute_sql");
      }
      const parsed = def.schema.safeParse(args ?? {});
      if (!parsed.success) return invalid(parsed.error);
      try {
        const data = await def.run(parsed.data, ctx);
        await audit(ctx, def.name, def.action ?? def.name, {
          resourceType: def.resourceType,
          resourceId: (parsed.data as { id?: string; article_id?: string; page_id?: string })?.id
            ?? (parsed.data as { article_id?: string }).article_id
            ?? (parsed.data as { page_id?: string }).page_id,
          after: data,
          success: true,
          relatedArticleId: (parsed.data as { article_id?: string }).article_id,
          relatedProfileId: (parsed.data as { profile_id?: string }).profile_id,
          relatedTaskId: (parsed.data as { task_id?: string }).task_id,
        });
        return { ok: true, data };
      } catch (error) {
        const message = error instanceof Error ? error.message : "The tool failed on the server.";
        await audit(ctx, def.name, def.action ?? def.name, {
          resourceType: def.resourceType,
          success: false,
          error: message,
          relatedArticleId: (parsed.data as { article_id?: string }).article_id,
          relatedProfileId: (parsed.data as { profile_id?: string }).profile_id,
          relatedTaskId: (parsed.data as { task_id?: string }).task_id,
        });
        return fail(error);
      }
    },
  });
}

function periodInput(p: z.infer<typeof periodSchema>) {
  if (!p) return { preset: "last-7" as const };
  if (p.period === "custom" || p.from || p.to) return { preset: "custom" as const, from: p.from, to: p.to };
  return { preset: p.period ?? "last-7" };
}

function publicSite(site: Record<string, unknown>) {
  const copy = { ...site };
  delete copy.customHead;
  return copy;
}

async function loadArticle(idOrSlug: string) {
  const repo = await import("@/content/repository.server");
  const data = await repo.adminList({ q: idOrSlug });
  const hit = (data.articles as Array<{ id: string; slug: string }>).find((a) => a.id === idOrSlug || a.slug === idOrSlug);
  if (hit) {
    const editor = await repo.adminEditor(hit.id);
    return editor;
  }
  // Fallback: try id directly
  try {
    return await repo.adminEditor(idOrSlug);
  } catch {
    throw new Error("That article was not found.");
  }
}

function actorSource(ctx: MasterToolCtx): PublishSource {
  return ctx.source ?? { via: "master", client: ctx.actor.clientName ?? null };
}

const empty = z.object({}).passthrough();

const defs: Array<(ctx: MasterToolCtx) => ToolDefinition> = [
  tool({
    name: "get_master_overview",
    title: "Master overview",
    description: "High-level snapshot of the site: content counts, recent publishing, automation status, Master connection activity, and remaining quotas. Daily publishing caps use the UTC calendar day.",
    schema: empty,
    hints: { readOnlyHint: true, idempotentHint: true },
    run: async (_input, ctx) => {
      const repo = await import("@/content/repository.server");
      const auto = await import("@/content/automation.server");
      const master = await import("@/content/master-mcp.server");
      const [overview, usage, connection, stats, tasks] = await Promise.all([
        repo.adminOverview(),
        auto.combinedPublishUsage(),
        master.getMasterConnection(),
        master.masterUsageStats(),
        master.listAgentTasks({ status: "pending", limit: 10 }),
      ]);
      return {
        overview: { ...overview, /* already no secrets */ },
        publishUsage: usage,
        capTimezone: "UTC",
        analyticsTimezone: "Asia/Kolkata",
        masterConnection: {
          status: connection.status,
          lastConnectedAt: connection.lastConnectedAt,
          lastActivityAt: connection.lastActivityAt,
          lastClientName: connection.lastClientName,
        },
        masterUsage: stats,
        pendingTasks: tasks.length,
        caller: { connectionId: ctx.actor.connectionId, clientName: ctx.actor.clientName ?? null },
      };
    },
  }),
  tool({
    name: "get_site_health",
    title: "Site health",
    description: "Safe diagnostics: database content counts, media and R2 usage, orphaned media, article status, recent automation errors, 404s, and sitemap/RSS/robots availability. Never includes Worker secrets or credentials. The backup payload is omitted.",
    schema: empty,
    hints: { readOnlyHint: true, idempotentHint: true },
    run: async () => {
      const repo = await import("@/content/repository.server");
      const health = await repo.siteHealth();
      const { backup: _backup, ...safe } = health as typeof health & { backup?: unknown };
      const [notFounds, runs, sitemap, feed] = await Promise.all([
        repo.listNotFounds(12),
        import("@/content/automation.server").then((m) => m.recentRuns(8)).catch(() => []),
        repo.readSitemap().then((s) => ({ ok: true, entries: Array.isArray(s) ? s.length : undefined })).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : "unavailable" })),
        repo.readFeed(5).then((s) => ({ ok: true, entries: Array.isArray(s) ? s.length : undefined })).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : "unavailable" })),
      ]);
      const errors = (runs as Array<{ outcome: string; reason?: string; createdAt: string; profileId: string; tool: string }>)
        .filter((r) => /fail|error|refused|rejected/i.test(r.outcome) || r.reason)
        .slice(0, 8);
      return {
        ...safe,
        notFounds,
        recentAutomationIssues: errors,
        feeds: { sitemap, rss: feed, robots: { path: "/robots.txt", note: "Served by the Worker when the site is up." } },
        capTimezone: "UTC",
      };
    },
  }),
  tool({
    name: "get_activity_feed",
    title: "Activity feed",
    description: "Recent administrator, Master MCP, Normal MCP and Special MCP activity, plus reader 404s.",
    schema: z.object({ limit: z.number().int().min(1).max(100).optional() }),
    hints: { readOnlyHint: true, idempotentHint: true },
    run: async () => {
      const repo = await import("@/content/repository.server");
      const [entries, notFounds] = await Promise.all([repo.activityFeed(), repo.listNotFounds(12)]);
      return { entries, notFounds };
    },
  }),
  tool({
    name: "get_daily_publishing_report",
    title: "Daily publishing report",
    description: "Per-profile and website-wide publishing report for a period. Distinguishes Normal, Special, manual and AI publishing. Daily caps are counted per UTC calendar day; report periods for analytics-style ranges use Asia/Kolkata (IST).",
    schema: z.object({ date: z.string().trim().max(20).optional(), period: z.enum(["today", "yesterday", "last-7", "last-28", "last-30", "custom"]).optional(), from: z.string().optional(), to: z.string().optional() }),
    hints: { readOnlyHint: true, idempotentHint: true },
    run: async (input) => {
      const auto = await import("@/content/automation.server");
      const analytics = await import("@/content/analytics.server");
      const period = periodInput({ period: input.period ?? (input.date ? "custom" : "today"), from: input.from ?? input.date, to: input.to ?? input.date });
      const [usage, publishing, profiles, runs] = await Promise.all([
        auto.combinedPublishUsage(),
        analytics.analyticsPublishing({ period }),
        auto.listProfiles(),
        auto.recentRuns(40),
      ]);
      return {
        capTimezone: "UTC",
        analyticsTimezone: "Asia/Kolkata",
        usage,
        publishing,
        profiles: profiles.map((p) => ({
          id: p.id,
          name: p.name,
          enabled: p.enabled,
          paused: p.paused,
          isDefault: p.isDefault,
        })),
        recentRuns: runs.map((r) => ({
          id: r.id,
          at: r.createdAt,
          profileId: r.profileId,
          tool: r.tool,
          outcome: r.outcome,
          reason: r.reason,
          articleId: r.articleId,
        })),
      };
    },
  }),
  tool({
    name: "get_master_permissions",
    title: "Master permissions",
    description: "The backend-enforced permission summary and the list of operations that are always rejected, with explanations.",
    schema: empty,
    hints: { readOnlyHint: true, idempotentHint: true },
    run: async () => ({
      summary: MASTER_PERMISSION_SUMMARY,
      prohibited: Object.entries(MASTER_PROHIBITED).map(([operation, reason]) => ({ operation, reason })),
      note: "Ordinary publishing profiles, including the default MCP_TOKEN profile, do not receive these privileges.",
    }),
  }),

  tool({
    name: "list_all_articles",
    title: "List all articles",
    description: "List and search articles by title, slug, topic, tag, writer, status, type or date. Includes Normal and Special articles.",
    schema: z.object({
      q: z.string().trim().max(200).optional(),
      status: z.enum(["draft", "published", "unpublished"]).optional(),
      topic_id: z.string().trim().max(80).optional(),
      tag_id: z.string().trim().max(80).optional(),
      writer: z.string().trim().max(200).optional(),
      article_type: z.enum(["special", "regular"]).optional(),
      sort: z.enum(["updated", "published", "title"]).optional(),
      from: z.string().trim().max(40).optional(),
      to: z.string().trim().max(40).optional(),
    }),
    hints: { readOnlyHint: true, idempotentHint: true },
    resourceType: "article",
    run: async (input) => {
      const repo = await import("@/content/repository.server");
      const data = await repo.adminList({
        q: input.q,
        status: input.status,
        categoryId: input.topic_id,
        tagId: input.tag_id,
        sort: input.sort,
        articleType: input.article_type,
      });
      let articles = data.articles as Array<Record<string, unknown> & { authorName?: string | null; publishedAt?: string | null; updatedAt?: string; title?: string }>;
      if (input.writer) {
        const w = input.writer.toLowerCase();
        articles = articles.filter((a) => (a.authorName ?? "").toLowerCase().includes(w));
      }
      if (input.from) {
        const from = Date.parse(input.from);
        if (!Number.isNaN(from)) articles = articles.filter((a) => Date.parse(String(a.publishedAt ?? a.updatedAt ?? "")) >= from);
      }
      if (input.to) {
        const to = Date.parse(input.to);
        if (!Number.isNaN(to)) articles = articles.filter((a) => Date.parse(String(a.publishedAt ?? a.updatedAt ?? "")) <= to);
      }
      return { articles, topics: data.categories, tags: data.tags };
    },
  }),
  tool({
    name: "get_full_article",
    title: "Get full article",
    description: "Read complete article content, metadata, provenance (creator, publisher, displayed writer — distinct from the MCP connection), revisions and lifecycle events. For Special articles, includes versioned long-form content from R2.",
    schema: z.object({ article_id: z.string().trim().min(1).max(80).optional(), slug: z.string().trim().min(1).max(80).optional() }).refine((v) => v.article_id || v.slug, "Provide article_id or slug."),
    hints: { readOnlyHint: true, idempotentHint: true },
    resourceType: "article",
    run: async (input) => {
      const repo = await import("@/content/repository.server");
      const master = await import("@/content/master-mcp.server");
      const editor = await loadArticle(input.article_id ?? input.slug!);
      const article = (editor as { article?: { id: string; articleType?: string } }).article;
      if (!article) throw new Error("That article was not found.");
      const [provenance, events, revisions] = await Promise.all([
        repo.loadArticleProvenance(article.id, { publishedAt: (article as { publishedAt?: string | null }).publishedAt ?? null, status: (article as { status?: string }).status ?? "draft" }),
        master.listArticleEvents(article.id, 40),
        repo.listRevisions(article.id),
      ]);
      let special: unknown = null;
      if (article.articleType === "special") {
        const sp = await import("@/content/special.server");
        const versions = await sp.specialVersions(article.id);
        const body = await sp.specialEditorBody(article.id).catch(() => null);
        special = { versions, body };
      }
      return { ...editor, provenance, events, revisions, special };
    },
  }),
  tool({
    name: "create_article",
    title: "Create article",
    description: "Create a Normal article (draft by default, or publish immediately). Special long-form articles should be created through the dedicated Special content fields (body markdown) when supported by update/create with article_type=special.",
    schema: z.object({
      title: z.string().trim().min(3).max(200),
      slug: z.string().trim().max(80).regex(/^[a-z0-9-]*$/).optional(),
      excerpt: z.string().trim().max(500).optional(),
      body: z.string().max(100_000).optional(),
      topic_ids: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
      tag_ids: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
      seo_title: z.string().trim().max(200).optional(),
      seo_description: z.string().trim().max(400).optional(),
      author_name: z.string().trim().max(200).optional(),
      featured: z.boolean().optional(),
      cover_media_id: z.string().trim().max(80).nullable().optional(),
      publish: z.boolean().optional(),
    }),
    resourceType: "article",
    action: "create",
    run: async (input, ctx) => {
      const repo = await import("@/content/repository.server");
      const { bodyToBlocks } = await import("@/lib/automation/body");
      const saved = await repo.saveArticle({
        title: input.title,
        slug: input.slug || undefined,
        excerpt: input.excerpt || "",
        topicIds: input.topic_ids,
        tagIds: input.tag_ids,
        seoTitle: input.seo_title ?? "",
        seoDescription: input.seo_description ?? "",
        authorName: input.author_name,
        featured: input.featured ?? false,
        coverMediaId: input.cover_media_id ?? null,
        blocks: input.body ? bodyToBlocks(input.body) : [],
        intent: input.publish ? "publish" : "save",
      }, actorSource(ctx));
      const { recordArticleEvent } = await import("@/content/master-mcp.server");
      await recordArticleEvent({ articleId: saved.id, action: input.publish ? "published" : "created", actorKind: "master-mcp", actorId: ctx.actor.connectionId, clientName: ctx.actor.clientName, detail: { slug: saved.slug, status: saved.status } });
      return saved;
    },
  }),
  tool({
    name: "update_article",
    title: "Update article",
    description: "Edit a draft, unpublished or published article (Master MCP may edit published articles even when ordinary profiles cannot). Returns a summary of what changed. For Special articles, send body as markdown to create a new version; never overwrite articles.blocks for Special bodies. Can also set featured status, SEO, excerpt, slug, topics, tags, cover and the displayed writer.",
    schema: z.object({
      article_id: z.string().trim().min(1).max(80),
      title: z.string().trim().min(3).max(200).optional(),
      slug: z.string().trim().max(80).regex(/^[a-z0-9-]*$/).optional(),
      excerpt: z.string().trim().max(500).optional(),
      body: z.string().max(100_000).optional(),
      topic_ids: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
      tag_ids: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
      seo_title: z.string().trim().max(200).optional(),
      seo_description: z.string().trim().max(400).optional(),
      author_name: z.string().trim().max(200).optional(),
      featured: z.boolean().optional(),
      cover_media_id: z.string().trim().max(80).nullable().optional(),
      enable_ai_edit: z.boolean().optional(),
    }),
    resourceType: "article",
    action: "update",
    run: async (input, ctx) => {
      const repo = await import("@/content/repository.server");
      const editor = await repo.adminEditor(input.article_id);
      const article = (editor as { article: Record<string, unknown> & { id: string; title: string; slug: string; excerpt: string; topicIds: string[]; tagIds: string[]; seoTitle?: string; seoDescription?: string; featured: boolean; coverMediaId?: string | null; blocks: unknown[]; articleType?: string; authorName?: string | null; motif?: string; publishedAt?: string | null } }).article;
      if (!article) throw new Error("That article was not found.");
      const before = { title: article.title, slug: article.slug, excerpt: article.excerpt, seoTitle: article.seoTitle, seoDescription: article.seoDescription, topicIds: article.topicIds, tagIds: article.tagIds, featured: article.featured, coverMediaId: article.coverMediaId, authorName: article.authorName };
      if (input.enable_ai_edit === true && !article.aiEditAllowed) {
        await repo.setAiEditAllowed(article.id, true);
      }
      const isSpecial = article.articleType === "special" || (await repo.articleTypeOf(article.id)) === "special";
      if (isSpecial && input.body) {
        const sp = await import("@/content/special.server");
        await sp.saveSpecialArticle({
          id: article.id,
          title: input.title ?? article.title,
          slug: input.slug ?? article.slug,
          excerpt: input.excerpt ?? article.excerpt,
          topicIds: input.topic_ids ?? article.topicIds,
          tagIds: input.tag_ids ?? article.tagIds,
          seoTitle: input.seo_title ?? article.seoTitle,
          seoDescription: input.seo_description ?? article.seoDescription,
          coverMediaId: input.cover_media_id !== undefined ? input.cover_media_id : article.coverMediaId,
          body: input.body,
          authorName: input.author_name ?? article.authorName,
        }, "master-mcp", { actor: actorSource(ctx) });
      } else {
        if (isSpecial && input.body) throw new Error("This is a special article: body updates must go through the Special article service.");
        const { bodyToBlocks } = await import("@/lib/automation/body");
        await repo.saveArticle({
          id: article.id,
          title: input.title ?? article.title,
          slug: input.slug ?? article.slug,
          excerpt: input.excerpt ?? article.excerpt,
          topicIds: input.topic_ids ?? article.topicIds,
          tagIds: input.tag_ids ?? article.tagIds,
          seoTitle: input.seo_title ?? article.seoTitle ?? "",
          seoDescription: input.seo_description ?? article.seoDescription ?? "",
          featured: input.featured ?? article.featured,
          coverMediaId: input.cover_media_id !== undefined ? input.cover_media_id : (article.coverMediaId ?? null),
          authorName: input.author_name,
          blocks: input.body ? bodyToBlocks(input.body) : article.blocks,
          motif: article.motif,
          publishedAt: article.publishedAt,
          intent: "save",
        }, actorSource(ctx));
      }
      const afterEditor = await repo.adminEditor(article.id);
      const afterArt = (afterEditor as { article: typeof article }).article;
      const after = { title: afterArt.title, slug: afterArt.slug, excerpt: afterArt.excerpt, seoTitle: afterArt.seoTitle, seoDescription: afterArt.seoDescription, topicIds: afterArt.topicIds, tagIds: afterArt.tagIds, featured: afterArt.featured, coverMediaId: afterArt.coverMediaId, authorName: afterArt.authorName };
      const changed = Object.keys(before).filter((k) => JSON.stringify(before[k as keyof typeof before]) !== JSON.stringify(after[k as keyof typeof after]));
      const { recordArticleEvent } = await import("@/content/master-mcp.server");
      await recordArticleEvent({ articleId: article.id, action: "edited", actorKind: "master-mcp", actorId: ctx.actor.connectionId, clientName: ctx.actor.clientName, detail: { changed } });
      return { id: article.id, slug: after.slug, changed, before, after };
    },
  }),
  tool({
    name: "publish_article",
    title: "Publish article",
    description: "Publish a draft or republish an unpublished article immediately.",
    schema: z.object({ article_id: z.string().trim().min(1).max(80) }),
    resourceType: "article",
    action: "publish",
    hints: { idempotentHint: true },
    run: async (input, ctx) => {
      const repo = await import("@/content/repository.server");
      const type = await repo.articleTypeOf(input.article_id);
      if (type === "special") {
        const sp = await import("@/content/special.server");
        await sp.publishSpecialArticle(input.article_id, actorSource(ctx));
      } else {
        const editor = await repo.adminEditor(input.article_id);
        const a = (editor as { article: Record<string, unknown> }).article;
        if (!a) throw new Error("That article was not found.");
        await repo.saveArticle({ ...a, intent: "publish" }, actorSource(ctx));
      }
      const { recordArticleEvent } = await import("@/content/master-mcp.server");
      await recordArticleEvent({ articleId: input.article_id, action: "published", actorKind: "master-mcp", actorId: ctx.actor.connectionId, clientName: ctx.actor.clientName });
      const saved = await repo.adminEditor(input.article_id);
      return { id: input.article_id, status: (saved as { article?: { status?: string } }).article?.status, slug: (saved as { article?: { slug?: string } }).article?.slug };
    },
  }),
  tool({
    name: "schedule_article",
    title: "Schedule article",
    description: "Schedule a draft for future publication. Pass a UTC ISO-8601 datetime.",
    schema: z.object({ article_id: z.string().trim().min(1).max(80), scheduled_at: z.string().datetime() }),
    resourceType: "article",
    action: "schedule",
    hints: { idempotentHint: true },
    run: async (input, ctx) => {
      const repo = await import("@/content/repository.server");
      const editor = await repo.adminEditor(input.article_id);
      const a = (editor as { article: Record<string, unknown> }).article;
      if (!a) throw new Error("That article was not found.");
      const saved = await repo.saveArticle({ ...a, scheduledAt: input.scheduled_at, intent: "save" }, actorSource(ctx));
      const { recordArticleEvent } = await import("@/content/master-mcp.server");
      await recordArticleEvent({ articleId: input.article_id, action: "scheduled", actorKind: "master-mcp", actorId: ctx.actor.connectionId, clientName: ctx.actor.clientName, detail: { scheduledAt: input.scheduled_at } });
      return { id: saved.id, slug: saved.slug, status: saved.status, scheduledAt: input.scheduled_at };
    },
  }),
  tool({
    name: "unpublish_article",
    title: "Unpublish article",
    description: "Unpublish a live article. It remains in the database and can be republished.",
    schema: z.object({ article_id: z.string().trim().min(1).max(80) }),
    resourceType: "article",
    action: "unpublish",
    hints: { idempotentHint: true },
    run: async (input, ctx) => {
      const repo = await import("@/content/repository.server");
      const type = await repo.articleTypeOf(input.article_id);
      if (type === "special") {
        const sp = await import("@/content/special.server");
        await sp.unpublishSpecialArticle(input.article_id);
      } else {
        const editor = await repo.adminEditor(input.article_id);
        const a = (editor as { article: Record<string, unknown> }).article;
        if (!a) throw new Error("That article was not found.");
        await repo.saveArticle({ ...a, intent: "unpublish" }, actorSource(ctx));
      }
      const { recordArticleEvent } = await import("@/content/master-mcp.server");
      await recordArticleEvent({ articleId: input.article_id, action: "unpublished", actorKind: "master-mcp", actorId: ctx.actor.connectionId, clientName: ctx.actor.clientName });
      const saved = await repo.adminEditor(input.article_id);
      return { id: input.article_id, status: (saved as { article?: { status?: string } }).article?.status, slug: (saved as { article?: { slug?: string } }).article?.slug };
    },
  }),
  tool({
    name: "duplicate_article",
    title: "Duplicate article",
    description: "Duplicate an article (including Special articles) as a new draft.",
    schema: z.object({ article_id: z.string().trim().min(1).max(80) }),
    resourceType: "article",
    action: "duplicate",
    run: async (input, ctx) => {
      const repo = await import("@/content/repository.server");
      const type = await repo.articleTypeOf(input.article_id);
      const result = type === "special"
        ? await (await import("@/content/special.server")).duplicateSpecialArticle(input.article_id)
        : await repo.duplicateArticle(input.article_id);
      const { recordArticleEvent } = await import("@/content/master-mcp.server");
      await recordArticleEvent({ articleId: result.id, action: "created", actorKind: "master-mcp", actorId: ctx.actor.connectionId, clientName: ctx.actor.clientName, detail: { duplicatedFrom: input.article_id } });
      return result;
    },
  }),
  tool({
    name: "preview_article_deletion",
    title: "Preview article deletion",
    description: "First stage of deletion: returns the article title, ID, slug, publication status, associated media, and a confirmation token bound to this exact article. The token expires in 15 minutes. Then call delete_article with the same article_id and confirmation_token.",
    schema: z.object({ article_id: z.string().trim().min(1).max(80) }),
    hints: { readOnlyHint: true },
    resourceType: "article",
    action: "preview_delete",
    run: async (input, ctx) => {
      const repo = await import("@/content/repository.server");
      const editor = await repo.adminEditor(input.article_id);
      const a = (editor as { article?: { id: string; title: string; slug: string; status: string; coverMediaId?: string | null } }).article;
      if (!a) throw new Error("That article was not found.");
      let coverInUseElsewhere = false;
      if (a.coverMediaId) {
        const media = await repo.listMedia();
        const item = media.find((m) => m.id === a.coverMediaId);
        coverInUseElsewhere = Boolean(item?.usedAsCover);
        // usedAsCover is true if any article uses it; check whether another article also uses it by listing
        const all = await repo.adminList({});
        const others = (all.articles as Array<{ id: string; coverMediaId?: string | null }>).filter((x) => x.id !== a.id && x.coverMediaId === a.coverMediaId);
        coverInUseElsewhere = others.length > 0;
        const settings = await repo.readSettings();
        const site = settings as { site?: { logoMediaId?: string | null; faviconMediaId?: string | null; defaultOgMediaId?: string | null } };
        const s = site.site ?? (settings as { logoMediaId?: string | null });
        const ids = [ (s as { logoMediaId?: string | null }).logoMediaId, (s as { faviconMediaId?: string | null }).faviconMediaId, (s as { defaultOgMediaId?: string | null }).defaultOgMediaId ];
        if (ids.includes(a.coverMediaId)) coverInUseElsewhere = true;
      }
      const preview = { articleId: a.id, title: a.title, slug: a.slug, status: a.status, coverMediaId: a.coverMediaId ?? null, coverInUseElsewhere };
      const { issueConfirmation } = await import("@/content/master-mcp.server");
      const { token, expiresAt } = await issueConfirmation({ actor: ctx.actor, action: "delete_article", resourceId: a.id, preview });
      return { ...preview, confirmationToken: token, expiresAt, note: "Call delete_article with this article_id and confirmation_token to permanently delete it. Associated media still used elsewhere will be kept." };
    },
  }),
  tool({
    name: "delete_article",
    title: "Delete article",
    description: "Permanently delete an article after preview_article_deletion. Requires the confirmation token issued for this exact article. Media still used by another article, page, logo or icon is never deleted.",
    schema: z.object({ article_id: z.string().trim().min(1).max(80), confirmation_token: z.string().trim().min(8).max(80), delete_cover_if_unused: z.boolean().optional() }),
    hints: { destructiveHint: true, idempotentHint: true },
    resourceType: "article",
    action: "delete",
    run: async (input, ctx) => {
      const { consumeConfirmation, recordArticleEvent } = await import("@/content/master-mcp.server");
      await consumeConfirmation({ token: input.confirmation_token, action: "delete_article", resourceId: input.article_id });
      const repo = await import("@/content/repository.server");
      const editor = await repo.adminEditor(input.article_id).catch(() => null);
      const slug = (editor as { article?: { slug?: string; title?: string; status?: string } } | null)?.article?.slug;
      const result = await repo.deleteArticle(input.article_id, { deleteCover: input.delete_cover_if_unused ?? true });
      await recordArticleEvent({ articleId: input.article_id, action: "deleted", actorKind: "master-mcp", actorId: ctx.actor.connectionId, clientName: ctx.actor.clientName, detail: { slug, coverDeleted: result.coverDeleted } });
      return { deleted: true, article_id: input.article_id, slug, coverDeleted: result.coverDeleted };
    },
  }),
  tool({
    name: "set_article_ai_edit_permission",
    title: "Set AI-edit permission",
    description: "Inspect or change the per-article “Allow AI to edit this article” grant. Ordinary MCP profiles continue to respect this flag; the Master MCP can edit regardless, but should still set the grant when asking another profile to correct the piece.",
    schema: z.object({ article_id: z.string().trim().min(1).max(80), allowed: z.boolean() }),
    hints: { idempotentHint: true },
    resourceType: "article",
    action: "set_ai_edit",
    run: async (input, ctx) => {
      const repo = await import("@/content/repository.server");
      await repo.setAiEditAllowed(input.article_id, input.allowed);
      const { recordArticleEvent } = await import("@/content/master-mcp.server");
      await recordArticleEvent({ articleId: input.article_id, action: "ai_edit_changed", actorKind: "master-mcp", actorId: ctx.actor.connectionId, clientName: ctx.actor.clientName, detail: { allowed: input.allowed } });
      return { article_id: input.article_id, allowed: input.allowed };
    },
  }),
  tool({
    name: "list_article_revisions",
    title: "List article revisions",
    description: "List saved revisions for a Normal article, or version history for a Special article.",
    schema: z.object({ article_id: z.string().trim().min(1).max(80) }),
    hints: { readOnlyHint: true, idempotentHint: true },
    resourceType: "article",
    run: async (input) => {
      const repo = await import("@/content/repository.server");
      const type = await repo.articleTypeOf(input.article_id);
      if (type === "special") {
        const versions = await (await import("@/content/special.server")).specialVersions(input.article_id);
        return { articleType: "special", versions };
      }
      return { articleType: "regular", revisions: await repo.listRevisions(input.article_id) };
    },
  }),
  tool({
    name: "restore_article_revision",
    title: "Restore article revision",
    description: "Restore a previous Normal-article revision (status and slug are preserved) or a Special-article version.",
    schema: z.object({ article_id: z.string().trim().min(1).max(80), revision_id: z.string().trim().min(1).max(80).optional(), version: z.number().int().min(1).optional() }),
    resourceType: "article",
    action: "restore",
    run: async (input, ctx) => {
      const repo = await import("@/content/repository.server");
      const type = await repo.articleTypeOf(input.article_id);
      if (type === "special") {
        if (!input.version) throw new Error("Provide version for a Special article.");
        const out = await (await import("@/content/special.server")).restoreSpecialVersion(input.article_id, input.version, "master-mcp");
        const { recordArticleEvent } = await import("@/content/master-mcp.server");
        await recordArticleEvent({ articleId: input.article_id, action: "restored", actorKind: "master-mcp", actorId: ctx.actor.connectionId, clientName: ctx.actor.clientName, detail: { version: input.version } });
        return out;
      }
      if (!input.revision_id) throw new Error("Provide revision_id for a Normal article.");
      const out = await repo.restoreRevision(input.revision_id);
      const { recordArticleEvent } = await import("@/content/master-mcp.server");
      await recordArticleEvent({ articleId: input.article_id, action: "restored", actorKind: "master-mcp", actorId: ctx.actor.connectionId, clientName: ctx.actor.clientName, detail: { revisionId: input.revision_id } });
      return out;
    },
  }),
];

export function buildMasterTools(ctx: MasterToolCtx): ToolDefinition[] {
  const built = defs.map((d) => d(ctx));
  built.push(...automationTools(ctx));
  built.push(...taskTools(ctx));
  built.push(...configTools(ctx));
  built.push(...analyticsTools(ctx));
  // Guard: never register prohibited names even if a typo adds them later.
  const blocked = new Set<string>(MASTER_PROHIBITED_TOOL_NAMES);
  return built.filter((t) => !blocked.has(t.name));
}

function redactProfile<T extends Record<string, unknown>>(p: T): T {
  const copy = { ...p };
  for (const key of ["tokenHint", "hasToken", "tokenCreatedAt", "oauth", "token_hash", "token", "clientSecret", "secret"]) delete copy[key];
  return copy;
}

function automationTools(ctx: MasterToolCtx): ToolDefinition[] {
  return [
    tool({
      name: "list_automation_profiles",
      title: "List automation profiles",
      description: "List existing Normal and Special automation profiles with operational status. Never includes API keys, OAuth secrets or Worker credentials.",
      schema: empty,
      hints: { readOnlyHint: true, idempotentHint: true },
      run: async () => {
        const auto = await import("@/content/automation.server");
        const { readSpecialSettings } = await import("@/content/special-settings.server");
        const { assignmentOf } = await import("@/lib/special/settings");
        const [profiles, special, usage] = await Promise.all([auto.listProfiles(), readSpecialSettings(), auto.combinedPublishUsage()]);
        return {
          profiles: profiles.map((p) => ({
            ...redactProfile(p as unknown as Record<string, unknown>),
            assignment: assignmentOf(special, p.id),
          })),
          usage,
          capTimezone: "UTC",
        };
      },
    })(ctx),
    tool({
      name: "get_automation_profile",
      title: "Get automation profile",
      description: "Inspect one profile: policy, topics, sources, schedule, limits, authors, next author, recent runs, daily count, remaining allowance and errors. Credentials are never included.",
      schema: z.object({ profile_id: z.string().trim().min(1).max(40) }),
      hints: { readOnlyHint: true, idempotentHint: true },
      resourceType: "profile",
      run: async (input) => {
        const auto = await import("@/content/automation.server");
        const { readSpecialSettings } = await import("@/content/special-settings.server");
        const { assignmentOf } = await import("@/lib/special/settings");
        const [settings, profiles, rotation, runs, usage, special] = await Promise.all([
          auto.readProfileSettings(input.profile_id),
          auto.listProfiles(),
          auto.readAuthorRotation(input.profile_id),
          auto.recentRuns(20, input.profile_id),
          auto.aiPublishUsageToday(input.profile_id),
          readSpecialSettings(),
        ]);
        const summary = profiles.find((p) => p.id === input.profile_id);
        if (!summary) throw new Error("Unknown automation profile.");
        const website = await auto.combinedPublishUsage();
        const used = usage.length;
        const cap = settings.policy.maxArticlesPerDay ?? 0;
        return {
          profile: redactProfile(summary as unknown as Record<string, unknown>),
          assignment: assignmentOf(special, input.profile_id),
          settings: {
            enabled: settings.enabled,
            paused: settings.paused,
            mode: settings.mode,
            topicIdeas: settings.topicIdeas,
            topicSources: settings.topicSources,
            topicSelection: settings.topicSelection,
            schedule: settings.schedule,
            policy: settings.policy,
            aiMayEditAllDrafts: settings.aiMayEditAllDrafts,
            imageTransfer: settings.imageTransfer,
          },
          authors: rotation,
          usageTodayUtc: { used, cap, remaining: cap > 0 ? Math.max(0, cap - used) : null, timezone: "UTC" },
          websiteUsage: website,
          recentRuns: runs.map((r) => ({ at: r.createdAt, tool: r.tool, outcome: r.outcome, reason: r.reason, articleId: r.articleId })),
        };
      },
    })(ctx),
    tool({
      name: "update_automation_profile",
      title: "Update automation profile",
      description: "Change operational configuration of an existing profile (rename, Normal/Special assignment, topics, sources, schedule, policy, limits). Cannot create or delete profiles, or issue credentials.",
      schema: z.object({
        profile_id: z.string().trim().min(1).max(40),
        name: z.string().trim().min(1).max(80).optional(),
        assignment: z.enum(["normal", "special"]).optional(),
        patch: z.record(z.string(), z.unknown()).optional(),
      }),
      resourceType: "profile",
      action: "update_profile",
      hints: { idempotentHint: true },
      run: async (input) => {
        if ("create" in (input.patch ?? {}) || "delete" in (input.patch ?? {})) denyMaster("create_automation_profile");
        const auto = await import("@/content/automation.server");
        if (input.name) await auto.renameProfile(input.profile_id, input.name);
        if (input.patch && Object.keys(input.patch).length) {
          const current = await auto.readProfileSettings(input.profile_id);
          const next = { ...current, ...input.patch, policy: { ...current.policy, ...((input.patch.policy as object) ?? {}) }, schedule: { ...current.schedule, ...((input.patch.schedule as object) ?? {}) }, topicSelection: { ...current.topicSelection, ...((input.patch.topicSelection as object) ?? {}) } };
          await auto.saveProfileSettings(input.profile_id, next);
        }
        if (input.assignment) {
          const { setProfileAssignment } = await import("@/content/special-settings.server");
          await setProfileAssignment(input.profile_id, input.assignment);
        }
        const settings = await auto.readProfileSettings(input.profile_id);
        return { profile_id: input.profile_id, name: input.name, assignment: input.assignment, enabled: settings.enabled, paused: settings.paused };
      },
    })(ctx),
    tool({
      name: "set_automation_status",
      title: "Set automation status",
      description: "Pause, resume, enable or disable an existing profile. This immediately blocks or allows further authorized website operations and publishing. It does not terminate any external AI agent process.",
      schema: z.object({
        profile_id: z.string().trim().min(1).max(40),
        enabled: z.boolean().optional(),
        paused: z.boolean().optional(),
      }).refine((v) => v.enabled !== undefined || v.paused !== undefined, "Set enabled and/or paused."),
      resourceType: "profile",
      action: "set_status",
      hints: { idempotentHint: true },
      run: async (input) => {
        const auto = await import("@/content/automation.server");
        const current = await auto.readProfileSettings(input.profile_id);
        const next = { ...current, enabled: input.enabled ?? current.enabled, paused: input.paused ?? current.paused };
        await auto.saveProfileSettings(input.profile_id, next);
        return {
          profile_id: input.profile_id,
          enabled: next.enabled,
          paused: next.paused,
          effect: "Further MCP write and publish operations from this profile will be accepted only while it is enabled and not paused. External agent processes are not terminated.",
        };
      },
    })(ctx),
    tool({
      name: "update_automation_publishing_limits",
      title: "Update publishing limits",
      description: "Change a profile's per-run cap, per-profile daily cap (UTC day), auto-publish, min words, sources and featured-image rules. The owner-defined website-wide daily cap remains the overriding safety ceiling and can be changed with update_website_settings (aiDailyPublishLimit).",
      schema: z.object({
        profile_id: z.string().trim().min(1).max(40),
        max_articles_per_day: z.number().int().min(0).max(100).optional(),
        max_published_per_run: z.number().int().min(0).max(20).optional(),
        auto_publish: z.boolean().optional(),
        min_words: z.number().int().min(100).max(10000).optional(),
        require_sources: z.boolean().optional(),
        min_sources: z.number().int().min(0).max(20).optional(),
        require_featured_image: z.boolean().optional(),
        website_daily_limit: z.number().int().min(0).max(100).optional(),
      }),
      resourceType: "profile",
      action: "update_limits",
      hints: { idempotentHint: true },
      run: async (input) => {
        const auto = await import("@/content/automation.server");
        const current = await auto.readProfileSettings(input.profile_id);
        const policy = {
          ...current.policy,
          maxArticlesPerDay: input.max_articles_per_day ?? current.policy.maxArticlesPerDay,
          maxPublishedPerRun: input.max_published_per_run ?? current.policy.maxPublishedPerRun,
          autoPublish: input.auto_publish ?? current.policy.autoPublish,
          minWords: input.min_words ?? current.policy.minWords,
          requireSources: input.require_sources ?? current.policy.requireSources,
          minSources: input.min_sources ?? current.policy.minSources,
          requireFeaturedImage: input.require_featured_image ?? current.policy.requireFeaturedImage,
        };
        await auto.saveProfileSettings(input.profile_id, { ...current, policy });
        if (input.website_daily_limit !== undefined) {
          const repo = await import("@/content/repository.server");
          const settings = await repo.readSettings();
          const site = (settings as { site?: Record<string, unknown> }).site ?? settings as Record<string, unknown>;
          await repo.saveSettings({ ...site, aiDailyPublishLimit: input.website_daily_limit });
        }
        return { profile_id: input.profile_id, policy, capTimezone: "UTC", websiteDailyLimitUpdated: input.website_daily_limit !== undefined };
      },
    })(ctx),
    tool({
      name: "update_automation_topics",
      title: "Update automation topics",
      description: "Change topic ideas, keywords, permitted topics and topic-selection preferences for a profile.",
      schema: z.object({
        profile_id: z.string().trim().min(1).max(40),
        topic_ideas: z.array(z.string().trim().min(1).max(300)).max(200).optional(),
        allowed_category_ids: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
        topic_selection: z.record(z.string(), z.unknown()).optional(),
      }),
      resourceType: "profile",
      action: "update_topics",
      hints: { idempotentHint: true },
      run: async (input) => {
        const auto = await import("@/content/automation.server");
        const current = await auto.readProfileSettings(input.profile_id);
        await auto.saveProfileSettings(input.profile_id, {
          ...current,
          topicIdeas: input.topic_ideas ?? current.topicIdeas,
          policy: { ...current.policy, allowedCategoryIds: input.allowed_category_ids ?? current.policy.allowedCategoryIds },
          topicSelection: { ...current.topicSelection, ...((input.topic_selection as object) ?? {}) },
        });
        return { profile_id: input.profile_id, updated: true };
      },
    })(ctx),
    tool({
      name: "update_automation_sources",
      title: "Update automation sources",
      description: "Add, remove or replace source URLs / topic sources for a profile.",
      schema: z.object({
        profile_id: z.string().trim().min(1).max(40),
        topic_sources: z.array(z.string().trim().url().max(500)).max(30),
      }),
      resourceType: "profile",
      action: "update_sources",
      hints: { idempotentHint: true },
      run: async (input) => {
        const auto = await import("@/content/automation.server");
        const current = await auto.readProfileSettings(input.profile_id);
        await auto.saveProfileSettings(input.profile_id, { ...current, topicSources: input.topic_sources });
        return { profile_id: input.profile_id, topic_sources: input.topic_sources };
      },
    })(ctx),
    tool({
      name: "update_automation_schedule",
      title: "Update automation schedule",
      description: "Change the profile's schedule settings (timezone, times, days). The schedule is guidance for the external agent; server-side write/publish still requires the profile to be enabled and not paused.",
      schema: z.object({
        profile_id: z.string().trim().min(1).max(40),
        timezone: z.string().trim().min(1).max(60).optional(),
        times: z.array(z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)).max(4).optional(),
        days: z.array(z.string()).max(7).optional(),
      }),
      resourceType: "profile",
      action: "update_schedule",
      hints: { idempotentHint: true },
      run: async (input) => {
        const auto = await import("@/content/automation.server");
        const current = await auto.readProfileSettings(input.profile_id);
        const schedule = {
          ...current.schedule,
          ...(input.timezone ? { timezone: input.timezone } : {}),
          ...(input.times ? { times: input.times } : {}),
          ...(input.days ? { days: input.days } : {}),
        };
        await auto.saveProfileSettings(input.profile_id, { ...current, schedule });
        return { profile_id: input.profile_id, schedule };
      },
    })(ctx),
    tool({
      name: "manage_automation_authors",
      title: "Manage automation authors",
      description: "Add, remove, rename or replace a profile's writer list, change rotation order or the next-author position, or set an article's displayed byline. The byline is kept separate from the MCP connection identity. Author names stay unique across profiles.",
      schema: z.object({
        profile_id: z.string().trim().min(1).max(40),
        action: z.enum(["list", "replace", "reset_next", "set_byline", "set_article_author"]),
        authors: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
        next_index: z.number().int().min(0).max(40).optional(),
        byline: z.string().trim().max(200).nullable().optional(),
        article_id: z.string().trim().max(80).optional(),
        author_name: z.string().trim().max(200).optional(),
      }),
      resourceType: "profile",
      action: "manage_authors",
      run: async (input, _ctx) => {
        const auto = await import("@/content/automation.server");
        if (input.action === "list") {
          return { rotation: await auto.readAuthorRotation(input.profile_id), byline: await auto.profileAuthorName(input.profile_id) };
        }
        if (input.action === "replace") {
          if (!input.authors) throw new Error("Provide authors.");
          const rotation = await auto.saveAuthorList(input.profile_id, input.authors, { reset: input.next_index === 0 });
          return { rotation };
        }
        if (input.action === "reset_next") {
          const current = await auto.readAuthorRotation(input.profile_id);
          const rotation = await auto.saveAuthorList(input.profile_id, current.names, { reset: true });
          return { rotation };
        }
        if (input.action === "set_byline") {
          const name = await auto.setProfileAuthor(input.profile_id, input.byline ?? null);
          return { byline: name };
        }
        if (input.action === "set_article_author") {
          if (!input.article_id || !input.author_name) throw new Error("Provide article_id and author_name.");
          const repo = await import("@/content/repository.server");
          const editor = await repo.adminEditor(input.article_id);
          const a = (editor as { article: Record<string, unknown> }).article;
          if (!a) throw new Error("That article was not found.");
          await repo.saveArticle({ ...a, authorName: input.author_name, intent: "save" });
          return { article_id: input.article_id, author_name: input.author_name };
        }
        throw new Error("Unknown action.");
      },
    })(ctx),
    tool({
      name: "get_automation_usage",
      title: "Get automation usage",
      description: "Remaining and used publishing allowance for one profile or the whole site, counted per UTC calendar day.",
      schema: z.object({ profile_id: z.string().trim().min(1).max(40).optional() }),
      hints: { readOnlyHint: true, idempotentHint: true },
      run: async (input) => {
        const auto = await import("@/content/automation.server");
        const website = await auto.combinedPublishUsage();
        if (!input.profile_id) return { capTimezone: "UTC", website };
        const settings = await auto.readProfileSettings(input.profile_id);
        const used = (await auto.aiPublishUsageToday(input.profile_id)).length;
        const cap = settings.policy.maxArticlesPerDay ?? 0;
        return { capTimezone: "UTC", website, profile: { id: input.profile_id, used, cap, remaining: cap > 0 ? Math.max(0, cap - used) : null, perRun: settings.policy.maxPublishedPerRun } };
      },
    })(ctx),
  ];
}

function taskTools(ctx: MasterToolCtx): ToolDefinition[] {
  return [
    tool({
      name: "assign_agent_task",
      title: "Assign agent task",
      description: "Create a persistent correction task for an existing automation profile, with instructions, optional article IDs, priority and deadline. The target agent picks it up the next time it connects. The task stays pending if that profile is paused or disabled. You can also make the correction yourself with update_article.",
      schema: z.object({
        profile_id: z.string().trim().min(1).max(40),
        title: z.string().trim().min(3).max(200),
        instructions: z.string().trim().min(3).max(8000),
        article_ids: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
        priority: z.enum(["low", "normal", "high"]).optional(),
        deadline_at: z.string().datetime().optional(),
      }),
      resourceType: "task",
      action: "assign",
      run: async (input, c) => {
        const auto = await import("@/content/automation.server");
        const profiles = await auto.listProfiles();
        if (!profiles.some((p) => p.id === input.profile_id)) throw new Error("Unknown automation profile.");
        const { createAgentTask } = await import("@/content/master-mcp.server");
        const task = await createAgentTask({
          actor: c.actor,
          targetProfileId: input.profile_id,
          title: input.title,
          instructions: input.instructions,
          articleIds: input.article_ids ?? [],
          priority: input.priority,
          deadlineAt: input.deadline_at,
        });
        return { task, note: "The task is queued. It is not complete until the target profile reports completion. You may also apply the correction yourself." };
      },
    })(ctx),
    tool({
      name: "list_agent_tasks",
      title: "List agent tasks",
      description: "List tasks, optionally filtered by profile and status.",
      schema: z.object({ profile_id: z.string().trim().max(40).optional(), status: z.enum(["pending", "claimed", "in_progress", "completed", "failed", "cancelled"]).optional(), limit: z.number().int().min(1).max(200).optional() }),
      hints: { readOnlyHint: true, idempotentHint: true },
      run: async (input) => {
        const { listAgentTasks } = await import("@/content/master-mcp.server");
        return { tasks: await listAgentTasks({ profileId: input.profile_id, status: input.status, limit: input.limit }) };
      },
    })(ctx),
    tool({
      name: "get_agent_task",
      title: "Get agent task",
      description: "Read one task and its result if the target profile has reported back.",
      schema: z.object({ task_id: z.string().trim().min(1).max(80) }),
      hints: { readOnlyHint: true, idempotentHint: true },
      resourceType: "task",
      run: async (input) => {
        const { getAgentTask } = await import("@/content/master-mcp.server");
        const task = await getAgentTask(input.task_id);
        if (!task) throw new Error("That task was not found.");
        return { task };
      },
    })(ctx),
    tool({
      name: "update_agent_task",
      title: "Update agent task",
      description: "Update a pending task's instructions, articles, priority or deadline.",
      schema: z.object({
        task_id: z.string().trim().min(1).max(80),
        title: z.string().trim().min(3).max(200).optional(),
        instructions: z.string().trim().min(3).max(8000).optional(),
        article_ids: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
        priority: z.enum(["low", "normal", "high"]).optional(),
        deadline_at: z.string().datetime().nullable().optional(),
      }),
      resourceType: "task",
      action: "update",
      hints: { idempotentHint: true },
      run: async (input) => {
        const { updateAgentTask } = await import("@/content/master-mcp.server");
        return { task: await updateAgentTask(input.task_id, { title: input.title, instructions: input.instructions, articleIds: input.article_ids, priority: input.priority, deadlineAt: input.deadline_at }) };
      },
    })(ctx),
    tool({
      name: "cancel_agent_task",
      title: "Cancel agent task",
      description: "Cancel a pending or claimed task that has not already completed.",
      schema: z.object({ task_id: z.string().trim().min(1).max(80) }),
      hints: { destructiveHint: true, idempotentHint: true },
      resourceType: "task",
      action: "cancel",
      run: async (input) => {
        const { cancelAgentTask } = await import("@/content/master-mcp.server");
        return { task: await cancelAgentTask(input.task_id) };
      },
    })(ctx),
    tool({
      name: "get_agent_task_results",
      title: "Get agent task results",
      description: "Read the result, affected article IDs and reported changes for a task. A task is only complete when its status is completed (or failed).",
      schema: z.object({ task_id: z.string().trim().min(1).max(80) }),
      hints: { readOnlyHint: true, idempotentHint: true },
      resourceType: "task",
      run: async (input) => {
        const { getAgentTask } = await import("@/content/master-mcp.server");
        const task = await getAgentTask(input.task_id);
        if (!task) throw new Error("That task was not found.");
        return {
          status: task.status,
          complete: task.status === "completed" || task.status === "failed" || task.status === "cancelled",
          resultSummary: task.resultSummary,
          resultArticleIds: task.resultArticleIds,
          resultChanges: task.resultChanges,
          error: task.error,
          completedAt: task.completedAt,
        };
      },
    })(ctx),
  ];
}

function configTools(ctx: MasterToolCtx): ToolDefinition[] {
  return [
    tool({
      name: "get_website_settings",
      title: "Get website settings",
      description: "Read public website configuration (identity, socials, sharing, analytics, publishing limits, homepage, appearance, ticker). Custom head scripts and secrets are omitted.",
      schema: empty,
      hints: { readOnlyHint: true, idempotentHint: true },
      run: async () => {
        const repo = await import("@/content/repository.server");
        const settings = await repo.readSettings();
        const site = publicSite(((settings as { site?: Record<string, unknown> }).site ?? settings) as Record<string, unknown>);
        return { site, capTimezone: "UTC" };
      },
    })(ctx),
    tool({
      name: "update_website_settings",
      title: "Update website settings",
      description: "Update permitted public website settings (name, description, socials, sharing, analytics measurement, website-wide AI publish cap, logos). customHead and any security or secret fields are rejected.",
      schema: z.object({ patch: z.record(z.string(), z.unknown()) }),
      action: "update_settings",
      hints: { idempotentHint: true },
      run: async (input) => {
        assertSitePatchAllowed(input.patch);
        const repo = await import("@/content/repository.server");
        const current = await repo.readSettings();
        const site = { ...(((current as { site?: Record<string, unknown> }).site ?? current) as Record<string, unknown>), ...input.patch };
        assertSitePatchAllowed(site);
        await repo.saveSettings(site);
        return { updated: Object.keys(input.patch), site: publicSite(site) };
      },
    })(ctx),
    tool({
      name: "get_homepage_configuration",
      title: "Get homepage configuration",
      description: "Read homepage builder blocks and the article sidebar configuration.",
      schema: empty,
      hints: { readOnlyHint: true, idempotentHint: true },
      run: async () => {
        const repo = await import("@/content/repository.server");
        const settings = await repo.readSettings();
        const site = ((settings as { site?: Record<string, unknown> }).site ?? settings) as Record<string, unknown>;
        return { home: site.home, articleSidebar: site.articleSidebar };
      },
    })(ctx),
    tool({
      name: "update_homepage_configuration",
      title: "Update homepage configuration",
      description: "Save a validated homepage builder and/or article sidebar configuration (blocks, visibility, order, headings, layout, counts).",
      schema: z.object({ home: z.unknown().optional(), article_sidebar: z.unknown().optional() }),
      action: "update_homepage",
      hints: { idempotentHint: true },
      run: async (input) => {
        const repo = await import("@/content/repository.server");
        const current = await repo.readSettings();
        const site = { ...(((current as { site?: Record<string, unknown> }).site ?? current) as Record<string, unknown>) };
        if (input.home !== undefined) site.home = input.home;
        if (input.article_sidebar !== undefined) site.articleSidebar = input.article_sidebar;
        await repo.saveSettings(site);
        return { home: site.home, articleSidebar: site.articleSidebar };
      },
    })(ctx),
    tool({
      name: "update_site_text",
      title: "Update site text",
      description: "Update visitor-facing wording: navigation labels, footer, section headings, buttons, error-page text, about wording and consent copy. Pass only the fields to change. Existing default/reset still lives in the admin desk.",
      schema: z.object({
        labels: z.record(z.string(), z.string()).optional(),
        nav: z.unknown().optional(),
        footer: z.unknown().optional(),
        about: z.unknown().optional(),
        consent_text: z.string().max(500).optional(),
      }),
      action: "update_site_text",
      hints: { idempotentHint: true },
      run: async (input) => {
        const repo = await import("@/content/repository.server");
        const current = await repo.readSettings();
        const site = { ...(((current as { site?: Record<string, unknown> }).site ?? current) as Record<string, unknown>) };
        if (input.labels) site.labels = { ...((site.labels as object) ?? {}), ...input.labels };
        if (input.nav) site.nav = input.nav;
        if (input.footer) site.footer = input.footer;
        if (input.about) site.about = input.about;
        if (input.consent_text) {
          const analytics = { ...((site.analytics as object) ?? {}), consentText: input.consent_text };
          site.analytics = analytics;
        }
        await repo.saveSettings(site);
        return { labels: site.labels, nav: site.nav, footer: site.footer, about: site.about };
      },
    })(ctx),
    tool({
      name: "update_appearance",
      title: "Update appearance",
      description: "Update light/dark theme colours, accent, text colours, cover fallback and other appearance settings. Colour values are validated and must keep readable contrast.",
      schema: z.object({ appearance: z.record(z.string(), z.unknown()) }),
      action: "update_appearance",
      hints: { idempotentHint: true },
      run: async (input) => {
        const repo = await import("@/content/repository.server");
        const current = await repo.readSettings();
        const site = { ...(((current as { site?: Record<string, unknown> }).site ?? current) as Record<string, unknown>) };
        const appearance = { ...((site.appearance as object) ?? {}), ...input.appearance } as { accent?: string; darkness?: number; whiteness?: number };
        if (appearance.accent && !/^#([0-9a-fA-F]{6})$/.test(appearance.accent)) throw new Error("Accent colour must be a #RRGGBB hex value.");
        if (appearance.accent) {
          const themes = themeColors({ darkness: appearance.darkness ?? 92, whiteness: appearance.whiteness ?? 100 });
          const worst = Math.min(contrast(appearance.accent, themes.light.paper), contrast(appearance.accent, themes.dark.paper));
          if (worst < 2) throw new Error(`That accent colour does not have enough contrast against the page background (ratio ${worst.toFixed(2)}). Choose a stronger colour.`);
        }
        site.appearance = appearance;
        await repo.saveSettings(site);
        return { appearance: site.appearance };
      },
    })(ctx),
    tool({
      name: "manage_pages",
      title: "Manage pages",
      description: "List, read, create, edit, publish/unpublish or delete custom pages. Reserved slugs and page validation still apply. Deleting requires confirmation_token from a prior action=preview_delete call.",
      schema: z.object({
        action: z.enum(["list", "get", "save", "delete", "preview_delete"]),
        id: z.string().trim().max(80).optional(),
        slug: z.string().trim().max(80).optional(),
        page: z.record(z.string(), z.unknown()).optional(),
        confirmation_token: z.string().trim().max(80).optional(),
      }),
      resourceType: "page",
      run: async (input, c) => {
        const repo = await import("@/content/repository.server");
        if (input.action === "list") return { pages: await repo.adminListPages() };
        if (input.action === "get") {
          const slug = input.slug;
          if (!slug) throw new Error("Provide slug.");
          const page = await repo.readPage(slug);
          if (!page) throw new Error("That page was not found.");
          return { page };
        }
        if (input.action === "save") {
          if (!input.page) throw new Error("Provide page.");
          return await repo.adminSavePage({ ...(input.page as object), actor: "master-mcp" } as Parameters<typeof repo.adminSavePage>[0]);
        }
        if (input.action === "preview_delete") {
          const id = input.id;
          if (!id) throw new Error("Provide id.");
          const pages = await repo.adminListPages() as Array<{ id: string; title?: string; slug?: string }>;
          const page = pages.find((p) => p.id === id);
          if (!page) throw new Error("That page was not found.");
          const { issueConfirmation } = await import("@/content/master-mcp.server");
          const { token, expiresAt } = await issueConfirmation({ actor: c.actor, action: "delete_page", resourceId: id, preview: page });
          return { ...page, confirmationToken: token, expiresAt };
        }
        if (input.action === "delete") {
          if (!input.id || !input.confirmation_token) throw new Error("Provide id and confirmation_token.");
          const { consumeConfirmation } = await import("@/content/master-mcp.server");
          await consumeConfirmation({ token: input.confirmation_token, action: "delete_page", resourceId: input.id });
          await repo.adminDeletePage({ id: input.id, actor: "master-mcp" });
          return { deleted: true, id: input.id };
        }
        throw new Error("Unknown action.");
      },
    })(ctx),
    tool({
      name: "manage_topics",
      title: "Manage topics",
      description: "List, create, edit or delete topics. Deleting a topic in use is refused and the blocking articles are identified.",
      schema: z.object({
        action: z.enum(["list", "save", "delete"]),
        id: z.string().trim().max(80).optional(),
        label: z.string().trim().max(80).optional(),
        slug: z.string().trim().max(80).optional(),
        description: z.string().trim().max(400).optional(),
      }),
      resourceType: "topic",
      run: async (input) => {
        const repo = await import("@/content/repository.server");
        if (input.action === "list") {
          const data = await repo.adminList({});
          return { topics: data.categories };
        }
        if (input.action === "save") {
          return await repo.saveCategory({ id: input.id, label: input.label, slug: input.slug, description: input.description });
        }
        if (input.action === "delete") {
          if (!input.id) throw new Error("Provide id.");
          try {
            await repo.deleteCategory(input.id);
            return { deleted: true, id: input.id };
          } catch (error) {
            const data = await repo.adminList({ categoryId: input.id });
            throw new Error(`${error instanceof Error ? error.message : "Could not delete that topic."} Blocking articles: ${(data.articles as Array<{ slug: string; title: string }>).map((a) => `${a.title} (${a.slug})`).slice(0, 20).join(", ") || "none listed"}.`);
          }
        }
        throw new Error("Unknown action.");
      },
    })(ctx),
    tool({
      name: "manage_tags",
      title: "Manage tags",
      description: "List, create, edit or delete tags. Deleting a tag in use is refused and the blocking articles are identified.",
      schema: z.object({
        action: z.enum(["list", "save", "delete"]),
        id: z.string().trim().max(80).optional(),
        label: z.string().trim().max(80).optional(),
        slug: z.string().trim().max(80).optional(),
      }),
      resourceType: "tag",
      run: async (input) => {
        const repo = await import("@/content/repository.server");
        if (input.action === "list") {
          const data = await repo.adminList({});
          return { tags: data.tags };
        }
        if (input.action === "save") {
          return await repo.saveTag({ id: input.id, label: input.label, slug: input.slug });
        }
        if (input.action === "delete") {
          if (!input.id) throw new Error("Provide id.");
          try {
            await repo.deleteTag(input.id);
            return { deleted: true, id: input.id };
          } catch (error) {
            const data = await repo.adminList({ tagId: input.id });
            throw new Error(`${error instanceof Error ? error.message : "Could not delete that tag."} Blocking articles: ${(data.articles as Array<{ slug: string; title: string }>).map((a) => `${a.title} (${a.slug})`).slice(0, 20).join(", ") || "none listed"}.`);
          }
        }
        throw new Error("Unknown action.");
      },
    })(ctx),
    tool({
      name: "manage_ticker",
      title: "Manage ticker",
      description: "Read or update the top strip / ticker: enable, label, source, manual slugs, custom items, count, animation and speed.",
      schema: z.object({ action: z.enum(["get", "update"]), trending: z.record(z.string(), z.unknown()).optional() }),
      action: "manage_ticker",
      hints: { idempotentHint: true },
      run: async (input) => {
        const repo = await import("@/content/repository.server");
        const current = await repo.readSettings();
        const site = { ...(((current as { site?: Record<string, unknown> }).site ?? current) as Record<string, unknown>) };
        if (input.action === "get") return { trending: site.trending };
        site.trending = { ...((site.trending as object) ?? {}), ...(input.trending ?? {}) };
        await repo.saveSettings(site);
        return { trending: site.trending };
      },
    })(ctx),
    tool({
      name: "manage_events",
      title: "Manage events",
      description: "List, create, edit, enable/disable or delete seasonal site events using the existing event validation.",
      schema: z.object({
        action: z.enum(["list", "save"]),
        config: z.unknown().optional(),
        version: z.string().trim().max(80).optional(),
      }),
      resourceType: "event",
      run: async (input) => {
        const events = await import("@/content/events.server");
        if (input.action === "list") return await events.readEventsForAdmin();
        if (!input.config || !input.version) throw new Error("Provide config and the current version token from action=list.");
        return await events.saveEvents(input.config, input.version);
      },
    })(ctx),
    tool({
      name: "manage_media",
      title: "Manage media",
      description: "List/search media, upload (https URL or base64), update alt text, attach/replace covers, inspect storage, or delete unused media. Existing file-type, size and reference checks apply. Media still used by an article, page, logo or icon cannot be deleted.",
      schema: z.object({
        action: z.enum(["list", "upload_url", "upload_base64", "delete", "set_article_cover", "storage"]),
        q: z.string().trim().max(200).optional(),
        media_id: z.string().trim().max(80).optional(),
        article_id: z.string().trim().max(80).optional(),
        url: z.string().url().optional(),
        filename: z.string().trim().max(200).optional(),
        alt: z.string().trim().max(300).optional(),
        data_base64: z.string().max(15_000_000).optional(),
        content_type: z.string().trim().max(80).optional(),
      }),
      resourceType: "media",
      run: async (input) => {
        const repo = await import("@/content/repository.server");
        if (input.action === "list") {
          const items = await repo.listMedia();
          const q = input.q?.toLowerCase();
          return { media: q ? items.filter((m) => m.filename.toLowerCase().includes(q) || (m.alt ?? "").toLowerCase().includes(q)) : items };
        }
        if (input.action === "storage") {
          const health = await repo.siteHealth();
          return { storage: health.storage, counts: health.counts };
        }
        if (input.action === "upload_url") {
          if (!input.url) throw new Error("Provide url.");
          const { fetchImage } = await import("@/lib/automation/image-fetch");
          const img = await fetchImage(input.url);
          return await repo.uploadMediaBytes({ bytes: img.bytes, mime: img.mime, filename: input.filename ?? "upload", alt: input.alt ?? "" });
        }
        if (input.action === "upload_base64") {
          if (!input.data_base64) throw new Error("Provide data_base64.");
          const { decodeBase64Image } = await import("@/lib/automation/image-fetch");
          const img = decodeBase64Image(input.data_base64);
          return await repo.uploadMediaBytes({ bytes: img.bytes, mime: img.mime, filename: input.filename ?? "upload", alt: input.alt ?? "" });
        }
        if (input.action === "set_article_cover") {
          if (!input.article_id) throw new Error("Provide article_id.");
          const editor = await repo.adminEditor(input.article_id);
          const a = (editor as { article: Record<string, unknown> }).article;
          if (!a) throw new Error("That article was not found.");
          const saved = await repo.saveArticle({ ...a, coverMediaId: input.media_id ?? null, intent: "save" });
          return { id: saved.id, slug: saved.slug, coverMediaId: input.media_id ?? null };
        }
        if (input.action === "delete") {
          if (!input.media_id) throw new Error("Provide media_id.");
          await repo.deleteMedia(input.media_id);
          return { deleted: true, media_id: input.media_id };
        }
        throw new Error("Unknown action.");
      },
    })(ctx),
    tool({
      name: "manage_ads",
      title: "Manage ads",
      description: "Manage structured advertisement settings (slots, visibility, placement, schedules, density, consent wording, statistics, historical versions). New or changed executable ad JavaScript is owner-only; restoring a previous owner-saved configuration is allowed.",
      schema: z.object({
        action: z.enum(["get", "update", "stats", "versions", "restore", "audit"]),
        settings: z.unknown().optional(),
        slot_id: z.string().trim().max(80).optional(),
        version_id: z.string().trim().max(80).optional(),
        days: z.number().int().min(1).max(90).optional(),
      }),
      resourceType: "ads",
      run: async (input, c) => {
        const ads = await import("@/lib/ads/ads.server");
        if (input.action === "get") return { settings: await ads.readAdsSettings() };
        if (input.action === "stats") return { stats: await ads.adStats(input.days ?? 28) };
        if (input.action === "audit") return { audit: await ads.auditLog(100) };
        if (input.action === "versions") {
          if (!input.slot_id) throw new Error("Provide slot_id.");
          return { versions: await ads.slotVersions(input.slot_id) };
        }
        if (input.action === "restore") {
          if (!input.version_id) throw new Error("Provide version_id.");
          const settings = await ads.restoreSlotVersion(input.version_id, `master-mcp:${c.actor.connectionId}`);
          return { settings, restored: true };
        }
        if (input.action === "update") {
          if (!input.settings) throw new Error("Provide settings.");
          const current = await ads.readAdsSettings();
          const historical: ReturnType<typeof collectAdsSnapshot>[] = [];
          // Restoring verbatim current is fine; new executable html/scripts are rejected.
          assertAdsPatchAllowed({ next: collectAdsSnapshot(input.settings), current: collectAdsSnapshot(current), historical });
          const settings = await ads.saveAdsSettings(input.settings, `master-mcp:${c.actor.connectionId}`);
          return { settings };
        }
        throw new Error("Unknown action.");
      },
    })(ctx),
    tool({
      name: "list_contact_messages",
      title: "Contact messages",
      description: "List, search, mark as reviewed, or delete contact messages (delete requires confirmation_token from action=preview_delete). There is no outbound email integration.",
      schema: z.object({
        action: z.enum(["list", "mark_handled", "delete", "preview_delete"]).optional(),
        q: z.string().trim().max(200).optional(),
        from: z.string().trim().max(40).optional(),
        to: z.string().trim().max(40).optional(),
        handled: z.boolean().optional(),
        id: z.string().trim().max(80).optional(),
        confirmation_token: z.string().trim().max(80).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      resourceType: "message",
      run: async (input, c) => {
        const contact = await import("@/content/contact.server");
        const action = input.action ?? "list";
        if (action === "list") {
          let rows = await contact.listContactMessages(input.limit ?? 200);
          if (typeof input.handled === "boolean") rows = rows.filter((r) => r.handled === input.handled);
          if (input.q) {
            const q = input.q.toLowerCase();
            rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.message.toLowerCase().includes(q));
          }
          if (input.from) {
            const from = Date.parse(input.from);
            if (!Number.isNaN(from)) rows = rows.filter((r) => Date.parse(r.createdAt) >= from);
          }
          if (input.to) {
            const to = Date.parse(input.to);
            if (!Number.isNaN(to)) rows = rows.filter((r) => Date.parse(r.createdAt) <= to);
          }
          return { messages: rows, outboundEmail: false };
        }
        if (action === "mark_handled") {
          if (!input.id) throw new Error("Provide id.");
          await contact.setContactHandled(input.id, input.handled ?? true);
          return { id: input.id, handled: input.handled ?? true };
        }
        if (action === "preview_delete") {
          if (!input.id) throw new Error("Provide id.");
          const rows = await contact.listContactMessages(500);
          const message = rows.find((r) => r.id === input.id);
          if (!message) throw new Error("That message was not found.");
          const { issueConfirmation } = await import("@/content/master-mcp.server");
          const { token, expiresAt } = await issueConfirmation({ actor: c.actor, action: "delete_message", resourceId: input.id, preview: { id: message.id, email: message.email, createdAt: message.createdAt } });
          return { id: message.id, email: message.email, createdAt: message.createdAt, confirmationToken: token, expiresAt };
        }
        if (action === "delete") {
          if (!input.id || !input.confirmation_token) throw new Error("Provide id and confirmation_token.");
          const { consumeConfirmation } = await import("@/content/master-mcp.server");
          await consumeConfirmation({ token: input.confirmation_token, action: "delete_message", resourceId: input.id });
          await contact.deleteContactMessage(input.id);
          return { deleted: true, id: input.id };
        }
        throw new Error("Unknown action.");
      },
    })(ctx),
  ];
}

function analyticsTools(ctx: MasterToolCtx): ToolDefinition[] {
  return [
    tool({
      name: "get_analytics_overview",
      title: "Analytics overview",
      description: "Website analytics for a selectable period (today, yesterday, last 7/28/30 days, or a custom range). Periods use Asia/Kolkata (IST). Missing, unavailable and zero-value metrics are distinguished by the underlying analytics layer.",
      schema: periodSchema.unwrap().partial(),
      hints: { readOnlyHint: true, idempotentHint: true },
      run: async (input) => {
        const analytics = await import("@/content/analytics.server");
        const extras = await analytics.analyticsExtras({ period: periodInput(input) }).catch(() => null);
        const overview = await analytics.analyticsOverview(periodInput(input));
        return { timezone: "Asia/Kolkata", overview, extras };
      },
    })(ctx),
    tool({
      name: "get_article_analytics",
      title: "Article analytics",
      description: "Analytics for one article, or the article leaderboard for a period (Asia/Kolkata).",
      schema: z.object({ article_id: z.string().trim().max(80).optional(), sort: z.string().trim().max(40).optional() }).merge(periodSchema.unwrap().partial()),
      hints: { readOnlyHint: true, idempotentHint: true },
      run: async (input) => {
        const analytics = await import("@/content/analytics.server");
        const period = periodInput(input);
        if (input.article_id) return { timezone: "Asia/Kolkata", article: await analytics.analyticsArticle({ id: input.article_id, period }) };
        return { timezone: "Asia/Kolkata", leaderboard: await analytics.analyticsLeaderboard({ period, sort: input.sort }) };
      },
    })(ctx),
    tool({
      name: "get_topic_analytics",
      title: "Topic analytics",
      description: "Topic and tag performance for a period (Asia/Kolkata).",
      schema: periodSchema.unwrap().partial(),
      hints: { readOnlyHint: true, idempotentHint: true },
      run: async (input) => {
        const analytics = await import("@/content/analytics.server");
        return { timezone: "Asia/Kolkata", topics: await analytics.analyticsTopics({ period: periodInput(input) }) };
      },
    })(ctx),
    tool({
      name: "get_traffic_sources",
      title: "Traffic sources",
      description: "Traffic sources and device breakdown for a period (Asia/Kolkata).",
      schema: periodSchema.unwrap().partial(),
      hints: { readOnlyHint: true, idempotentHint: true },
      run: async (input) => {
        const analytics = await import("@/content/analytics.server");
        const period = periodInput(input);
        const [sources, devices] = await Promise.all([
          analytics.analyticsSources({ period }),
          analytics.analyticsDevices({ period }),
        ]);
        return { timezone: "Asia/Kolkata", sources, devices };
      },
    })(ctx),
    tool({
      name: "get_automation_analytics",
      title: "Automation analytics",
      description: "Publishing analytics per automation profile, including generated/drafted/published/failed/skipped counts and remaining allowance. UTC day for caps; Asia/Kolkata for analytics ranges.",
      schema: periodSchema.unwrap().partial(),
      hints: { readOnlyHint: true, idempotentHint: true },
      run: async (input) => {
        const analytics = await import("@/content/analytics.server");
        const auto = await import("@/content/automation.server");
        const [publishing, usage, profiles] = await Promise.all([
          analytics.analyticsPublishing({ period: periodInput(input) }),
          auto.combinedPublishUsage(),
          auto.listProfiles(),
        ]);
        return {
          capTimezone: "UTC",
          analyticsTimezone: "Asia/Kolkata",
          publishing,
          usage,
          profiles: profiles.map((p) => ({ id: p.id, name: p.name, enabled: p.enabled, paused: p.paused })),
        };
      },
    })(ctx),
    tool({
      name: "get_publishing_history",
      title: "Publishing history",
      description: "Article-level provenance and recent publish/edit history. Answers which agent published an article, the displayed writer, and what happened recently. The displayed author is never confused with the MCP connection identity.",
      schema: z.object({ article_id: z.string().trim().max(80).optional(), profile_id: z.string().trim().max(40).optional(), limit: z.number().int().min(1).max(100).optional() }),
      hints: { readOnlyHint: true, idempotentHint: true },
      run: async (input, _c) => {
        const repo = await import("@/content/repository.server");
        const auto = await import("@/content/automation.server");
        const master = await import("@/content/master-mcp.server");
        if (input.article_id) {
          const editor = await repo.adminEditor(input.article_id);
          const article = (editor as { article?: { id: string; authorName?: string | null; publishedAt?: string | null; status?: string } }).article;
          if (!article) throw new Error("That article was not found.");
          const [provenance, events, runs] = await Promise.all([
            repo.loadArticleProvenance(article.id, { publishedAt: article.publishedAt ?? null, status: article.status ?? "draft" }),
            master.listArticleEvents(article.id, 40),
            auto.recentRuns(20).then((rows) => rows.filter((r) => r.articleId === article.id)),
          ]);
          return { authorName: article.authorName ?? null, provenance, events, runs };
        }
        const runs = await auto.recentRuns(input.limit ?? 40, input.profile_id);
        return { runs: runs.map((r) => ({ at: r.createdAt, profileId: r.profileId, tool: r.tool, outcome: r.outcome, reason: r.reason, articleId: r.articleId, auth: r.auth })) };
      },
    })(ctx),
  ];
}

/** Number of catalog tools that must be registered (test helper). */
export function expectedMasterToolCount(): number {
  return MASTER_TOOL_CATALOG.length;
}
