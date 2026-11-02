/**
 * t173: special articles — server glue between the admin/MCP/public layers and
 * the versioned store (src/lib/special/store.ts). Metadata rides the existing
 * article rows (saveArticleRows with blocks = []), the body lives in R2.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { workerEnv } from "@/lib/cf-env.server";
import { articleWriteSchema } from "./validate";
import { ContentError, saveArticleRows, assignRotatingAuthor, articleTypeOf, readSpecialPayload, readSpecialPreviewPayload, readSpecialArchive } from "./repository.server";
import {
  assertPublishable,
  bodyKey,
  chartKey,
  deleteSpecialObjects,
  listVersions,
  readAutosave,
  readCurrentBody,
  readState,
  readVersionBody,
  restoreVersion,
  saveSpecialBody,
  SpecialStoreError,
  versionKeys,
  writeAutosave,
  type BucketLike,
} from "@/lib/special/store";
import { SpecialBodyError, specialToc, type SpecialBody, type SpecialContent } from "@/lib/special/body";
import { chartSvg } from "@/lib/special/chart";

export const specialMetaSchema = articleWriteSchema.omit({ blocks: true, intent: true }).extend({
  intent: z.enum(["save", "publish", "unpublish"]),
  content: z.unknown(),
  note: z.string().max(200).optional(),
});
export type SpecialMetaWrite = z.infer<typeof specialMetaSchema>;

async function bucket(): Promise<BucketLike> {
  const env = await workerEnv();
  const b = env.MEDIA as BucketLike | undefined;
  if (!b || typeof b.put !== "function") throw new ContentError("Article storage (R2 binding MEDIA) is not available.", 503);
  return b;
}

function rethrow(error: unknown): never {
  if (error instanceof SpecialStoreError) throw new ContentError(error.message, error.status);
  if (error instanceof SpecialBodyError) throw new ContentError(error.message);
  throw error;
}

async function mediaInfo(mediaId: string) {
  const sql = await getSql();
  const rows = await sql<{ width: number | null; height: number | null }>`select width, height from media where id = ${mediaId}`.catch(() => []);
  return rows[0] ? { width: Number(rows[0].width ?? 0) || undefined, height: Number(rows[0].height ?? 0) || undefined } : null;
}

/** Best effort: deterministic chart SVGs in R2 (traceable to the body's data). The chart route also renders on demand. */
async function storeCharts(b: BucketLike, id: string, content: Pick<SpecialContent, "blocks">) {
  for (const block of content.blocks) {
    if (block.type !== "chart") continue;
    await b.put(chartKey(id, block.chartId), chartSvg(block), { httpMetadata: { contentType: "image/svg+xml" } }).catch(() => undefined);
  }
}

export type SaveSpecialResult = { id: string; slug: string; status: string; version: number; wordCount: number; author?: string | null };

/**
 * Saves a new version (R2 first, then D1). intent "publish" publishes only after the
 * save fully succeeded AND the stored body is readable; "unpublish" unpublishes.
 */
export async function saveSpecialArticle(raw: unknown, by = "admin", opts: { allowPublish?: boolean } = {}): Promise<SaveSpecialResult> {
  const input = specialMetaSchema.parse(raw);
  let authorOverride: string | null | undefined;
  if (input.authorName !== undefined) {
    const { checkAuthorName } = await import("@/lib/author-name");
    const checked = checkAuthorName(input.authorName);
    if (!checked.ok) throw new ContentError(checked.error);
    authorOverride = checked.value;
  }
  if (input.intent === "publish" && !input.excerpt.trim()) throw new ContentError("Add an excerpt before publishing.");
  const sql = await getSql();
  const b = await bucket();
  const meta = { ...input, blocks: [], intent: "save" as const };
  delete (meta as { content?: unknown }).content;
  delete (meta as { note?: unknown }).note;
  let saved;
  try {
    saved = await saveSpecialBody(
      {
        sql,
        bucket: b,
        mediaInfo,
        saveRows: (id, isNew) => saveArticleRows({ ...meta, id: isNew ? null : id }, () => undefined, authorOverride, { newId: id, articleType: "special" }),
      },
      { id: input.id, content: input.content, by, note: input.note, newId: () => randomUUID() },
    );
  } catch (error) {
    rethrow(error);
  }
  const content = await readCurrentBody(sql, b, saved.id).catch(() => null);
  if (content) await storeCharts(b, saved.id, content.body);
  if (input.intent === "publish" && opts.allowPublish !== false) {
    const pub = await publishSpecialArticle(saved.id);
    return { ...saved, status: "published", author: pub.author };
  }
  if (input.intent === "unpublish") {
    await unpublishSpecialArticle(saved.id);
    return { ...saved, status: "unpublished" };
  }
  return saved;
}

export async function publishSpecialArticle(id: string): Promise<{ author: string | null }> {
  if ((await articleTypeOf(id)) !== "special") throw new ContentError("That special article no longer exists.", 404);
  const sql = await getSql();
  const rows = await sql<{ excerpt: string; status: string; published_at: string | null }>`select excerpt, status, published_at from articles where id = ${id}`;
  const row = rows[0];
  if (!row) throw new ContentError("That special article no longer exists.", 404);
  if (!row.excerpt?.trim()) throw new ContentError("Add an excerpt before publishing.");
  try {
    await assertPublishable(sql, await bucket(), id);
  } catch (error) {
    rethrow(error);
  }
  const first = row.status !== "published" && !row.published_at;
  const now = new Date().toISOString();
  await sql`update articles set status = 'published', published_at = coalesce(published_at, ${now}), scheduled_at = null, updated_at = ${now} where id = ${id}`;
  const author = first ? await assignRotatingAuthor(id).catch(() => null) : null;
  return { author };
}

export async function unpublishSpecialArticle(id: string): Promise<void> {
  if ((await articleTypeOf(id)) !== "special") throw new ContentError("That special article no longer exists.", 404);
  const sql = await getSql();
  await sql`update articles set status = 'unpublished', updated_at = ${new Date().toISOString()} where id = ${id}`;
}

export async function specialVersions(id: string) {
  const sql = await getSql();
  return listVersions(sql, id);
}

export async function restoreSpecialVersion(id: string, version: number, by = "admin") {
  if ((await articleTypeOf(id)) !== "special") throw new ContentError("That special article no longer exists.", 404);
  const sql = await getSql();
  try {
    const result = await restoreVersion(sql, await bucket(), id, version, by);
    await sql`update articles set updated_at = ${new Date().toISOString()} where id = ${id}`;
    return result;
  } catch (error) {
    rethrow(error);
  }
}

export async function autosaveSpecial(id: string, content: unknown) {
  if ((await articleTypeOf(id)) !== "special") throw new ContentError("Save the article once before autosave can run.", 409);
  try {
    return await writeAutosave(await getSql(), await bucket(), id, content);
  } catch (error) {
    rethrow(error);
  }
}

/** Editor payload: current body + version list + newer autosave (if any). */
export async function specialEditorBody(id: string) {
  const sql = await getSql();
  const b = await bucket();
  const [current, versions, state, autosave] = await Promise.all([
    readCurrentBody(sql, b, id),
    listVersions(sql, id),
    readState(sql, id),
    readAutosave(b, id).catch(() => null),
  ]);
  const newerAutosave = autosave && state?.autosaveAt && (!state.updatedAt || state.autosaveAt > state.updatedAt) ? autosave : null;
  return { body: current?.body ?? null, version: current?.version ?? 0, versions, autosave: newerAutosave, autosaveAt: newerAutosave ? state?.autosaveAt ?? null : null };
}

export async function readSpecialVersion(id: string, version: number): Promise<SpecialBody | null> {
  return readVersionBody(await bucket(), bodyKey(id, version));
}

// Immutable keys -> parsed body. Small per-isolate cache; version keys never change content.
const bodyCache = new Map<string, SpecialBody>();
async function cachedCurrentBody(id: string): Promise<SpecialBody | null> {
  const sql = await getSql();
  const rows = await sql<{ r2_key: string }>`select v.r2_key from special_article_state s join special_article_versions v on v.article_id = s.article_id and v.version = s.current_version where s.article_id = ${id}`;
  const key = rows[0]?.r2_key;
  if (!key) return null;
  const hit = bodyCache.get(key);
  if (hit) return hit;
  const body = await readVersionBody(await bucket(), key);
  if (body) {
    if (bodyCache.size > 40) bodyCache.delete(bodyCache.keys().next().value as string);
    bodyCache.set(key, body);
  }
  return body;
}

function publicBody(body: SpecialBody) {
  return { blocks: body.blocks, sources: body.sources, resources: body.resources, coverCredit: body.coverCredit ?? null, toc: specialToc(body.blocks), version: body.version };
}

export async function readSpecialArticle(slug: string) {
  const payload = await readSpecialPayload(slug);
  if (!payload) return null;
  const body = await cachedCurrentBody(payload.article.id);
  if (!body) return null; // never render a special without a body
  return { ...payload, body: publicBody(body) };
}

export async function readSpecialPreview(id: string) {
  const payload = await readSpecialPreviewPayload(id);
  if (!payload) return null;
  const sql = await getSql();
  const current = await readCurrentBody(sql, await bucket(), id);
  if (!current) return null;
  return { ...payload, body: publicBody(current.body) };
}

export { readSpecialArchive };

/** Chart SVG for a published special (rendered from the stored data). */
export async function readSpecialChart(slug: string, chartId: string): Promise<string | null> {
  const payload = await readSpecialPayload(slug);
  if (!payload) return null;
  const body = await cachedCurrentBody(payload.article.id);
  const chart = body?.blocks.find((b) => b.type === "chart" && b.chartId === chartId);
  return chart && chart.type === "chart" ? chartSvg(chart) : null;
}

export async function duplicateSpecialArticle(id: string): Promise<{ id: string; slug: string }> {
  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`select title, excerpt, category_id, motif, seo_title, seo_description, cover_media_id from articles where id = ${id}`;
  const src = rows[0];
  if (!src) throw new ContentError("That article no longer exists.", 404);
  const topics = await sql<{ category_id: string }>`select category_id from article_topics where article_id = ${id}`.catch(() => []);
  const tags = await sql<{ tag_id: string }>`select tag_id from article_tags where article_id = ${id}`;
  const current = await readCurrentBody(sql, await bucket(), id);
  const saved = await saveSpecialArticle({
    id: null,
    title: String(src.title),
    slug: "",
    excerpt: String(src.excerpt ?? ""),
    categoryId: String(src.category_id),
    topicIds: topics.length ? [String(src.category_id), ...topics.map((t) => t.category_id).filter((t) => t !== src.category_id)].slice(0, 4) : undefined,
    tagIds: tags.map((t) => t.tag_id),
    motif: src.motif as "corner",
    featured: false,
    seoTitle: String(src.seo_title ?? ""),
    seoDescription: String(src.seo_description ?? ""),
    coverMediaId: (src.cover_media_id as string | null) ?? null,
    publishedAt: null,
    scheduledAt: null,
    intent: "save",
    content: current ? { blocks: current.body.blocks, sources: current.body.sources, resources: current.body.resources, coverCredit: current.body.coverCredit } : { blocks: [] },
    note: "Duplicated",
  });
  return { id: saved.id, slug: saved.slug };
}

/** Called by deleteArticle before rows go: returns the R2 cleanup to run after the D1 delete succeeded. */
export async function prepareSpecialDelete(id: string): Promise<() => Promise<void>> {
  const sql = await getSql();
  const keys = await versionKeys(sql, id);
  const charts = (await readCurrentBody(sql, await bucket(), id).catch(() => null))?.body.blocks.flatMap((b) => (b.type === "chart" ? [chartKey(id, b.chartId)] : [])) ?? [];
  return async () => deleteSpecialObjects(await bucket(), [...keys, ...charts], id);
}
