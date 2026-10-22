const randomUUID = () => crypto.randomUUID();
import { articles as seedArticles } from "./articles";
import { articlePlainText, readingMinutes, type ArticleMeta } from "./present";
import { MediaBindingError, openMediaStore } from "./media-store.server";
import { site } from "./site";
import { categories as seedCategories, tags as seedTags } from "./taxonomy";
import { tickerEntries } from "./ticker";
import { STANDARD_PAGES, standardPage } from "./pages-seed";
import { resolveBlocks } from "./blocks";
import type { Article, ArticleBlock, Category, PublicationStatus, SiteConfig, Tag } from "./types";
import {
  articleWriteSchema,
  categoryWriteSchema,
  decodeImage,
  mediaWriteSchema,
  normalizeSite,
  parseSite,
  publishProblems,
  slugify,
  tagWriteSchema,
  type ArticleWrite,
} from "./validate";
import { getSql, withTransaction, type Sql } from "@/lib/db";
import { REVISION_KEEP, buildRestoreInput, mergeActivityFeed, sanitizeNotFoundPath, type RevisionSnapshot } from "../lib/admin-followup.ts";
import { assertAiCanAccess, assertAiPatchAllowed, type AiActor, type AiEditAction } from "@/lib/automation/ai-edit";
import { cutoffFor, filterOldArticles, type OldArticleQuery } from "@/lib/old-articles";

export class ContentError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ContentError";
    this.status = status;
  }
}

type ArticleRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  status: PublicationStatus;
  published_at: string | Date | null;
  updated_at: string | Date;
  category_id: string;
  motif: Article["motif"];
  featured: boolean | number;
  seo_title: string | null;
  seo_description: string | null;
  cover_media_id: string | null;
  scheduled_at?: string | null;
  blocks: ArticleBlock[] | string;
};

// A plain flag, not a shared promise: workerd hangs requests that await a
// promise created by another request. Seeding is idempotent (insert or ignore).
let seeded = false;

export async function ensureContent(): Promise<void> {
  if (seeded) return;
  const { writesAllowed } = await import("@/lib/write-guard.server");
  if (!(await writesAllowed())) return;
  await seedIfEmpty();
  seeded = true;
}

async function seedIfEmpty(): Promise<void> {
  await withTransaction(async (sql) => {
    const existing = await sql<{ n: number }>`select count(*)::int as n from articles`;
    if (Number(existing[0]?.n ?? 0) > 0) {
      const settings = await sql`select id from site_settings where id = 'site'`;
      if (settings.length === 0) {
        await sql`insert or ignore into site_settings (id, data) values ('site', ${JSON.stringify(site)}::jsonb)`;
      }
      return;
    }
    for (const category of seedCategories) {
      await sql`insert or ignore into categories (id, slug, label, description) values (${category.id}, ${category.slug}, ${category.label}, ${category.description})`;
    }
    for (const tag of seedTags) {
      await sql`insert or ignore into tags (id, slug, label) values (${tag.id}, ${tag.slug}, ${tag.label})`;
    }
    for (const article of seedArticles) {
      await sql`insert or ignore into articles (
        id, slug, title, excerpt, status, published_at, updated_at, category_id, motif, featured,
        seo_title, seo_description, cover_media_id, blocks
      ) values (
        ${article.id}, ${article.slug}, ${article.title}, ${article.excerpt}, ${article.status},
        ${article.publishedAt}, ${article.updatedAt}, ${article.categoryId}, ${article.motif},
        ${article.featured}, ${article.seoTitle ?? null}, ${article.seoDescription ?? null},
        ${article.coverMediaId ?? null}, ${JSON.stringify(article.blocks)}::jsonb
      )`;
      for (const tagId of article.tagIds) {
        await sql`insert or ignore into article_tags (article_id, tag_id) values (${article.id}, ${tagId})`;
      }
      for (const topicId of article.topicIds) {
        await sql`insert or ignore into article_topics (article_id, category_id) values (${article.id}, ${topicId})`.catch(() => undefined);
      }
    }
    await sql`insert or ignore into site_settings (id, data) values ('site', ${JSON.stringify(site)}::jsonb)`;
  });
}

function iso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function mapArticle(row: ArticleRow, tagIds: string[], topicIds: string[], coverAlt: string | null = null): Article {
  const blocks = typeof row.blocks === "string" ? (JSON.parse(row.blocks) as ArticleBlock[]) : row.blocks;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    status: row.status,
    publishedAt: iso(row.published_at),
    updatedAt: iso(row.updated_at) ?? new Date(0).toISOString(),
    categoryId: row.category_id,
    topicIds: topicIds.length ? topicIds : [row.category_id],
    tagIds,
    motif: row.motif,
    featured: Boolean(row.featured),
    seoTitle: row.seo_title ?? undefined,
    seoDescription: row.seo_description ?? undefined,
    coverMediaId: row.cover_media_id,
    scheduledAt: iso(row.scheduled_at ?? null),
    coverAlt,
    blocks,
  };
}

async function tagMap(sql: Sql, ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  // D1/SQLite accepts at most 100 bound variables per statement, so a
  // growing archive must be read in chunks (this broke get_blog_settings
  // and article lists once the article count passed 100).
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += 50) chunks.push(ids.slice(start, start + 50));
  const perChunk = await Promise.all(
    chunks.map((chunk) => {
      const placeholders = chunk.map((_, index) => `$${index + 1}`).join(", ");
      return sql.query<{ article_id: string; tag_id: string }>(
        `select article_id, tag_id from article_tags where article_id in (${placeholders})`,
        chunk,
      );
    }),
  );
  const links = perChunk.flat();
  for (const link of links) {
    const list = map.get(link.article_id) ?? [];
    list.push(link.tag_id);
    map.set(link.article_id, list);
  }
  return map;
}

async function topicMap(sql: Sql, ids: string[]): Promise<Map<string, string[]>> {
  // article_topics arrives with migration 0007. Until a database has it,
  // articles simply have their primary topic only.
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  try {
    const chunks: string[][] = [];
    for (let start = 0; start < ids.length; start += 50) chunks.push(ids.slice(start, start + 50));
    const perChunk = await Promise.all(
      chunks.map((chunk) => {
        const placeholders = chunk.map((_, index) => `$${index + 1}`).join(", ");
        return sql.query<{ article_id: string; category_id: string }>(
          `select article_id, category_id from article_topics where article_id in (${placeholders}) order by rowid`,
          chunk,
        );
      }),
    );
    const links = perChunk.flat();
  for (const link of links) {
      const list = map.get(link.article_id) ?? [];
      list.push(link.category_id);
      map.set(link.article_id, list);
    }
  } catch {
    return map;
  }
  return map;
}

export async function sweepDueScheduled(sql: Sql): Promise<number> {
  // t68: Workers have no cron here, so due drafts are published by a
  // request-time sweep (throttled per isolate). Documented in the editor:
  // an article goes live on the first site/admin request after its time.
  const nowMs = Date.now();
  if (nowMs - lastScheduleSweep < 30_000) return 0;
  lastScheduleSweep = nowMs;
  try {
    const due = await sql<{ id: string }>`select id from articles where status = 'draft' and scheduled_at is not null and scheduled_at <= ${new Date(nowMs).toISOString()} limit 20`;
    for (const row of due) {
      await sql`update articles set status = 'published', published_at = scheduled_at, scheduled_at = null, updated_at = ${new Date(nowMs).toISOString()} where id = ${row.id} and status = 'draft'`;
    }
    return due.length;
  } catch {
    return 0; // pre-0010 database: scheduling simply inactive
  }
}

let lastScheduleSweep = 0;

async function loadArticles(sql: Sql, where = "", params: unknown[] = []): Promise<Article[]> {
  await sweepDueScheduled(sql);
  let rows: ArticleRow[];
  try {
    rows = await sql.query<ArticleRow>(
      `select id, slug, title, excerpt, status, published_at, updated_at, category_id, motif, featured,
              seo_title, seo_description, cover_media_id, scheduled_at, blocks
       from articles ${where}`,
      params,
    );
  } catch {
    rows = await sql.query<ArticleRow>(
      `select id, slug, title, excerpt, status, published_at, updated_at, category_id, motif, featured,
              seo_title, seo_description, cover_media_id, blocks
       from articles ${where}`,
      params,
    );
  }
  const ids = rows.map((row) => row.id);
  // Independent lookups run together: each D1 round-trip is a network hop,
  // so serial awaits were the article page's main server-side cost (t56).
  const [tags, topics, coverAlts] = await Promise.all([tagMap(sql, ids), topicMap(sql, ids), coverAltMap(sql, rows)]);
  return rows.map((row) => {
    const article = mapArticle(row, tags.get(row.id) ?? [], topics.get(row.id) ?? [], row.cover_media_id ? (coverAlts.get(row.cover_media_id) ?? null) : null);
    // The primary topic always leads, even if the join table is stale.
    if (article.topicIds[0] !== article.categoryId) {
      article.topicIds = [article.categoryId, ...article.topicIds.filter((id) => id !== article.categoryId)];
    }
    return article;
  });
}

/** media id -> stored alt text for cover images. Never throws (older DBs just fall back to titles). */
async function coverAltMap(sql: Sql, rows: ArticleRow[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const mediaIds = [...new Set(rows.map((r) => r.cover_media_id).filter((v): v is string => Boolean(v)))];
  if (mediaIds.length === 0) return map;
  try {
    for (let start = 0; start < mediaIds.length; start += 50) {
      const chunk = mediaIds.slice(start, start + 50);
      const placeholders = chunk.map((_, i) => `$${i + 1}`).join(", ");
      const found = await sql.query<{ id: string; alt: string }>(`select id, alt from media where id in (${placeholders})`, chunk);
      for (const m of found) if (m.alt?.trim()) map.set(m.id, m.alt.trim());
    }
  } catch {
    return map;
  }
  return map;
}

function byNewest(a: Article, b: Article): number {
  return Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? "");
}

async function catalog(): Promise<{ articles: Article[]; categories: Category[]; tags: Tag[]; site: SiteConfig }> {
  await ensureContent();
  const sql = await getSql();
  const [articles, categories, tags, settings] = await Promise.all([
    loadArticles(sql, "order by updated_at desc"),
    sql<Category>`select id, slug, label, description from categories order by label asc`,
    sql<Tag>`select id, slug, label from tags order by label asc`,
    sql<{ data: SiteConfig | string }>`select data from site_settings where id = 'site'`,
  ]);
  const raw = settings[0]?.data;
  const siteConfig = normalizeSite(typeof raw === "string" ? JSON.parse(raw) : raw);
  return { articles, categories, tags, site: siteConfig };
}
