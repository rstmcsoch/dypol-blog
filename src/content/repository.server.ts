const randomUUID = () => crypto.randomUUID();
import { articles as seedArticles } from "./articles";
import { readingMinutes, type ArticleMeta } from "./present";
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
  // Run the independent catalog reads concurrently (see loadArticles note).
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

/** Built-in content shipped with the code. Public pages fall back to it when D1 fails. */
function staticCatalog(): Awaited<ReturnType<typeof catalog>> {
  return {
    articles: seedArticles.map((article) => ({ ...article, coverMediaId: article.coverMediaId ?? null })),
    categories: seedCategories,
    tags: seedTags,
    site: normalizeSite(site),
  };
}

async function publicCatalog(): Promise<Awaited<ReturnType<typeof catalog>>> {
  try {
    return await catalog();
  } catch (error) {
    console.error("[content] D1 unavailable, serving built-in content.", error);
    return staticCatalog();
  }
}

function published(articles: Article[]): Article[] {
  return articles.filter((article) => article.status === "published" && article.publishedAt).sort(byNewest);
}

function categoryOf(categories: Category[], idOrSlug: string): Category | undefined {
  return categories.find((category) => category.id === idOrSlug || category.slug === idOrSlug);
}

export function metaFor(articles: Article[], publishedOrder: Article[], categories: Category[]): Record<string, ArticleMeta> {
  const meta: Record<string, ArticleMeta> = {};
  for (const article of articles) {
    const rank = publishedOrder.findIndex((item) => item.id === article.id);
    meta[article.id] = {
      rank: rank === -1 ? 0 : rank + 1,
      categoryLabel: categoryOf(categories, article.categoryId)?.label ?? "",
      topicLabels: article.topicIds.map((id) => categoryOf(categories, id)?.label ?? "").filter(Boolean),
      minutes: readingMinutes(article),
    };
  }
  return meta;
}

function needsViews(site: SiteConfig): boolean {
  const all = [...site.home.blocks, ...site.articleSidebar.blocks];
  return site.trending.source === "popular" || all.some((b) => b.enabled && (b.type === "popular" || (b.type === "ticker" && site.trending.source === "popular")));
}

/** article id -> view count. Never throws (an older database without the table just has no counts). */
async function viewCounts(site: SiteConfig): Promise<Record<string, number>> {
  if (!needsViews(site)) return {};
  try {
    const sql = await getSql();
    const rows = await sql<{ article_id: string; views: number }>`select article_id, views from article_views`;
    return Object.fromEntries(rows.map((r) => [r.article_id, Number(r.views)]));
  } catch {
    return {};
  }
}

/** Privacy-friendly counter: one integer per article, no IPs, cookies or user data stored. */
export async function recordView(slug: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`select id from articles where slug = ${slug} and status = 'published' limit 1`;
  const id = rows[0]?.id;
  if (!id) return false;
  const now = new Date().toISOString();
  await sql`insert into article_views (article_id, views, updated_at) values (${id}, 1, ${now})
    on conflict (article_id) do update set views = views + 1, updated_at = excluded.updated_at`;
  return true;
}

export async function readShell() {
  const [data, pages] = await Promise.all([publicCatalog(), readPageLinks()]);
  const live = published(data.articles);
  return { site: data.site, trending: tickerEntries(data.site, live, await viewCounts(data.site)), pages };
}

// ---------- pages (t52: standard reader-facing pages, admin-only CMS) -----
type PageRow = { slug: string; title: string; body: string; status: string; updated_at: string };

async function dbPages(): Promise<(PageRow & { id: string })[] | null> {
  try {
    const sql = await getSql();
    return await sql.query<PageRow & { id: string }>("select id,slug,title,body,status,updated_at from pages order by slug");
  } catch {
    return null; // pre-0008 database or no binding: built-in defaults below
  }
}

/** Published page by slug. D1 when available; built-in defaults otherwise. */
export async function readPage(slug: string): Promise<PageRow | null> {
  const rows = await dbPages();
  if (rows) {
    const row = rows.find((r) => r.slug === slug);
    return row && row.status === "published" ? row : null;
  }
  const seed = standardPage(slug);
  return seed ? { slug: seed.slug, title: seed.title, body: seed.body, status: "published", updated_at: "2026-10-18T00:00:00.000Z" } : null;
}

/** Footer links: published pages, standard pages first in reading order. */
export async function readPageLinks(): Promise<{ slug: string; title: string; updatedAt?: string }[]> {
  const rows = await dbPages();
  const publishedRows = rows ? rows.filter((r) => r.status === "published") : STANDARD_PAGES.map((p) => ({ slug: p.slug, title: p.title, updated_at: "2026-10-18T00:00:00.000Z" }));
  const order = new Map(STANDARD_PAGES.map((p, i) => [p.slug, i]));
  return [...publishedRows]
    .sort((a, b) => (order.get(a.slug) ?? 99) - (order.get(b.slug) ?? 99) || a.title.localeCompare(b.title))
    .map((r) => ({ slug: r.slug, title: r.title, updatedAt: (r as { updated_at?: string }).updated_at }));
}

export async function adminListPages() {
  const rows = await dbPages();
  if (!rows) throw new Error("The pages table is missing. Apply migration 0008 first.");
  return rows.map((row) => ({ ...row, standard: STANDARD_PAGES.some((p) => p.slug === row.slug) }));
}

export async function adminSavePage(input: import("@/lib/pages").PageWrite & { actor: string }) {
  let sql;
  try {
    sql = await getSql();
  } catch {
    throw new Error("The pages store needs the database. Apply migration 0008 first.");
  }
  const now = new Date().toISOString();
  const id = input.id && input.id.trim() ? input.id.trim() : input.slug;
  try {
    if (input.id) {
      await sql.query("update pages set slug=$1, title=$2, body=$3, status=$4, updated_at=$5 where id=$6", [input.slug, input.title, input.body, input.status, now, input.id]);
    } else {
      await sql.query("insert into pages (id,slug,title,body,status,updated_at) values ($1,$2,$3,$4,$5,$6)", [id, input.slug, input.title, input.body, input.status, now]);
    }
  } catch (e) {
    if (String(e).includes("UNIQUE")) throw new Error(`A page with slug "${input.slug}" already exists.`);
    throw new Error("Could not save the page. If this is a fresh database, apply migration 0008 first.");
  }
  return { id, slug: input.slug, updatedAt: now };
}

export async function adminDeletePage(input: { id: string; actor: string }) {
  const sql = await getSql();
  await sql.query("delete from pages where id=$1", [input.id]);
  return { ok: true as const };
}

export async function readHome(draftSite?: SiteConfig) {
  const data = await publicCatalog();
  const site = draftSite ?? data.site;
  const live = published(data.articles);
  const blocks = resolveBlocks(site.home.blocks, { site, live, categories: data.categories, tags: data.tags, views: await viewCounts(site) }, "home");
  return { blocks, empty: live.length === 0, site };
}

export async function readIndex() {
  const data = await publicCatalog();
  const live = published(data.articles);
  return { articles: live, meta: metaFor(live, live, data.categories) };
}

export async function readTopics() {
  const data = await publicCatalog();
  const live = published(data.articles);
  return {
    topics: data.categories.map((category) => ({
      category,
      count: live.filter((article) => article.topicIds.includes(category.id)).length,
    })),
  };
}

export async function readTopic(slug: string) {
  const data = await publicCatalog();
  const category = categoryOf(data.categories, slug);
  if (!category) return null;
  const live = published(data.articles).filter((article) => article.topicIds.includes(category.id));
  const all = published(data.articles);
  return { category, articles: live, meta: metaFor(live, all, data.categories) };
}

export async function readArticle(slug: string) {
  const data = await publicCatalog();
  const live = published(data.articles);
  const article = live.find((item) => item.slug === slug);
  if (!article) return null;
  return articlePayload(data, article, live);
}

export async function readPreview(id: string) {
  const data = await catalog();
  const article = data.articles.find((item) => item.id === id);
  if (!article) return null;
  const live = published(data.articles);
  return articlePayload(data, article, live);
}

async function articlePayload(
  data: Awaited<ReturnType<typeof catalog>>,
  article: Article,
  live: Article[],
) {
  const index = live.findIndex((item) => item.id === article.id);
  const same = live.filter((item) => item.id !== article.id && item.topicIds.some((id) => article.topicIds.includes(id)));
  const rest = live.filter((item) => item.id !== article.id && !same.some((picked) => picked.id === item.id));
  const related = [...same, ...rest].slice(0, 3);
  const sidebar = data.site.articleSidebar.enabled
    ? resolveBlocks(data.site.articleSidebar.blocks, { site: data.site, live, categories: data.categories, tags: data.tags, views: await viewCounts(data.site), current: article }, "sidebar")
    : [];
  return {
    article,
    category: categoryOf(data.categories, article.categoryId) ?? null,
    topics: article.topicIds
      .map((id) => categoryOf(data.categories, id))
      .filter((category): category is Category => Boolean(category)),
    tags: article.tagIds
      .map((id) => data.tags.find((tag) => tag.id === id))
      .filter((tag): tag is Tag => Boolean(tag)),
    related,
    neighbors: {
      newer: index > 0 ? live[index - 1] : undefined,
      older: index >= 0 ? live[index + 1] : undefined,
    },
    rank: index === -1 ? 0 : index + 1,
    sidebar,
    meta: metaFor(related, live, data.categories),
  };
}

export async function readSitemap() {
  const data = await publicCatalog();
  const live = published(data.articles);
  const labelOf = new Map(data.categories.map((c) => [c.id, c.label]));
  const pageLinks = await readPageLinks();
  return {
    pages: pageLinks.map((p) => ({ slug: p.slug, lastmod: p.updatedAt ?? null })),
    articles: live.map((article) => ({
      slug: article.slug,
      lastmod: article.updatedAt,
      publishedAt: article.publishedAt,
      updatedAt: article.updatedAt,
      title: article.title,
      excerpt: article.excerpt,
      topics: article.topicIds.map((id) => labelOf.get(id) ?? "").filter(Boolean),
      coverMediaId: article.coverMediaId ?? null,
    })),
    topics: data.categories.map((category) => {
      const inTopic = live.filter((a) => a.topicIds.includes(category.id));
      const lastmod = inTopic.reduce<string | null>((max, a) => (max && max > a.updatedAt ? max : a.updatedAt), null);
      return { slug: category.slug, lastmod, count: inTopic.length };
    }),
  };
}

/** Latest published articles for the RSS feed (newest first). */
export async function readFeed(limit = 20) {
  const data = await publicCatalog();
  const labelOf = new Map(data.categories.map((c) => [c.id, c.label]));
  return published(data.articles)
    .slice(0, limit)
    .map((article) => ({
      slug: article.slug,
      title: article.title,
      excerpt: article.excerpt,
      description: article.seoDescription ?? article.excerpt,
      publishedAt: article.publishedAt,
      updatedAt: article.updatedAt,
      topics: article.topicIds.map((id) => labelOf.get(id) ?? "").filter(Boolean),
      coverMediaId: article.coverMediaId ?? null,
    }));
}

export type ArticleSummary = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  status: PublicationStatus;
  publishedAt: string | null;
  updatedAt: string;
  categoryId: string;
  categoryLabel: string;
  topicIds: string[];
  tagIds: string[];
  featured: boolean;
  hasCover: boolean;
  aiEditAllowed: boolean;
  views: number;
  words: number;
  scheduledAt: string | null;
  /** t72: draft flagged topic_review by the automation signal check. */
  topicReview?: boolean;
};

export async function adminOverview() {
  const data = await catalog();
  const counts = {
    published: data.articles.filter((article) => article.status === "published").length,
    draft: data.articles.filter((article) => article.status === "draft").length,
    unpublished: data.articles.filter((article) => article.status === "unpublished").length,
    scheduled: data.articles.filter((article) => article.status === "draft" && article.scheduledAt).length,
    topics: data.categories.length,
    tags: data.tags.length,
  };
  const library = await openMediaStore().catch((error: unknown) => {
    if (error instanceof MediaBindingError) return null;
    throw error;
  });
  const media = library ? await library.stats() : { files: 0, bytes: 0 };
  const views = await viewCounts(data.site).catch(() => ({}) as Record<string, number>);
  const totalViews = Object.values(views).reduce((sum, n) => sum + n, 0);
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const publishedThisWeek = data.articles.filter((a) => a.status === "published" && a.publishedAt && Date.parse(a.publishedAt) >= weekAgo).length;
  const topArticles = data.articles
    .filter((a) => a.status === "published")
    .map((article) => summarize(article, data.categories, new Set(), views[article.id] ?? 0))
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);
  const recent = [...data.articles]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 6)
    .map((article) => summarize(article, data.categories, new Set(), views[article.id] ?? 0));
  const attention = data.articles
    .filter((article) => article.status !== "published")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 6)
    .map((article) => summarize(article, data.categories, new Set(), views[article.id] ?? 0));
  let recentRuns: { id: string; tool: string; outcome: string; createdAt: string; profileId: string }[] = [];
  try {
    const { recentRuns: loadRuns } = await import("./automation.server");
    recentRuns = (await loadRuns(6)).map((r) => ({ id: r.id, tool: r.tool, outcome: r.outcome, createdAt: r.createdAt, profileId: r.profileId }));
  } catch {
    recentRuns = [];
  }
  return {
    counts,
    media: { files: media.files, bytes: media.bytes },
    totalViews,
    publishedThisWeek,
    topArticles,
    recent,
    attention,
    recentRuns,
  };
}

/** Site health snapshot + settings backup payload (t68). */
export async function siteHealth() {
  const data = await catalog();
  const library = await openMediaStore().catch((error: unknown) => {
    if (error instanceof MediaBindingError) return null;
    throw error;
  });
  const storage = library ? await library.storageStats() : { files: 0, storedBytes: 0, originalBytes: 0, variantBytes: 0 };
  const mediaItems = library ? await library.list() : [];
  const usedMedia = new Set<string>();
  for (const a of data.articles) if (a.coverMediaId) usedMedia.add(a.coverMediaId);
  if (data.site.logoMediaId) usedMedia.add(data.site.logoMediaId);
  if (data.site.faviconMediaId) usedMedia.add(data.site.faviconMediaId);
  const orphanMedia = mediaItems.filter((m) => !usedMedia.has(m.id)).length;
  const views = await viewCounts(data.site).catch(() => ({}) as Record<string, number>);
  let lastAutomationRun: string | null = null;
  try {
    const { recentRuns } = await import("./automation.server");
    lastAutomationRun = (await recentRuns(1))[0]?.createdAt ?? null;
  } catch {
    lastAutomationRun = null;
  }
  const { readAutomationSettings } = await import("./automation.server");
  return {
    counts: {
      published: data.articles.filter((a) => a.status === "published").length,
      draft: data.articles.filter((a) => a.status === "draft").length,
      unpublished: data.articles.filter((a) => a.status === "unpublished").length,
      scheduled: data.articles.filter((a) => a.status === "draft" && a.scheduledAt).length,
      topics: data.categories.length,
      tags: data.tags.length,
      mediaFiles: storage.files,
      orphanMedia,
    },
    storage,
    totalViews: Object.values(views).reduce((sum, n) => sum + n, 0),
    lastAutomationRun,
    backup: { site: data.site, automation: await readAutomationSettings().catch(() => null) },
  };
}

export function articleWordCount(article: Article): number {
  const text = article.blocks.map((b) => (b.type === "list" ? b.items.join(" ") : b.type === "code" ? "" : b.text)).join(" ");
  return text.split(/\s+/).filter(Boolean).length;
}

function summarize(article: Article, categories: Category[], grants: Set<string> = new Set(), views = 0): ArticleSummary {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    status: article.status,
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
    categoryId: article.categoryId,
    categoryLabel: categoryOf(categories, article.categoryId)?.label ?? "",
    topicIds: article.topicIds,
    tagIds: article.tagIds,
    featured: article.featured,
    hasCover: Boolean(article.coverMediaId),
    aiEditAllowed: grants.has(article.id),
    views,
    words: articleWordCount(article),
    scheduledAt: article.scheduledAt ?? null,
  };
}

export async function adminList(input: {
  q?: string;
  status?: PublicationStatus;
  categoryId?: string;
  tagId?: string;
  sort?: "updated" | "published" | "title";
}) {
  const data = await catalog();
  const q = input.q?.trim().toLowerCase() ?? "";
  let rows = data.articles.filter((article) => {
    if (input.status && article.status !== input.status) return false;
    if (input.categoryId && !article.topicIds.includes(input.categoryId)) return false;
    if (input.tagId && !article.tagIds.includes(input.tagId)) return false;
    if (!q) return true;
    return article.title.toLowerCase().includes(q) || article.slug.toLowerCase().includes(q);
  });
  rows = [...rows].sort((a, b) => {
    if (input.sort === "title") return a.title.localeCompare(b.title);
    if (input.sort === "published") return Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? "");
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
  const grants = await aiEditGrantIds();
  const views = await viewCounts(data.site).catch(() => ({}) as Record<string, number>);
  // t72: surface the topic_review flag on drafts so rote filings are visible.
  let topicReview = new Set<string>();
  try {
    const sql = await getSql();
    const flagged = await sql<{ article_id: string }>`select article_id from automation_submissions where flags like '%topic_review%'`;
    topicReview = new Set(flagged.map((r) => r.article_id));
  } catch { /* submissions table absent on very old dbs */ }
  return {
    articles: rows.map((article) => ({ ...summarize(article, data.categories, grants, views[article.id] ?? 0), topicReview: topicReview.has(article.id) })),
    categories: data.categories,
    tags: data.tags,
  };
}

/** Clone an article as a fresh draft (t68). Views, featured flag and schedule do not carry over. */
export async function duplicateArticle(id: string): Promise<{ id: string; slug: string }> {
  const data = await catalog();
  const source = data.articles.find((a) => a.id === id);
  if (!source) throw new ContentError("That article no longer exists.", 404);
  return saveArticle({
    id: null,
    title: source.title,
    slug: "",
    excerpt: source.excerpt,
    categoryId: source.categoryId,
    topicIds: source.topicIds,
    tagIds: source.tagIds,
    motif: source.motif,
    featured: false,
    seoTitle: source.seoTitle ?? "",
    seoDescription: source.seoDescription ?? "",
    coverMediaId: source.coverMediaId ?? null,
    publishedAt: null,
    scheduledAt: null,
    blocks: source.blocks,
    intent: "save",
  });
}

export async function adminEditor(id: string | null) {
  const data = await catalog();
  const library = await openMediaStore().catch((error: unknown) => {
    if (error instanceof MediaBindingError) return null;
    throw error;
  });
  const media = library
    ? (await library.list()).map((item) => ({ id: item.id, filename: item.filename, alt: item.alt }))
    : [];
  const article = id ? (data.articles.find((item) => item.id === id) ?? null) : null;
  if (article) article.aiEditAllowed = (await aiEditGrantIds()).has(article.id);
  return {
    article,
    categories: data.categories,
    tags: data.tags,
    media,
    publishedSlugs: published(data.articles).map((item) => item.slug),
  };
}

async function uniqueSlug(sql: Sql, base: string, ignoreId: string | null): Promise<string> {
  let slug = slugify(base);
  let n = 2;
  for (;;) {
    const rows = await sql<{ id: string }>`select id from articles where slug = ${slug}`;
    if (rows.length === 0 || rows[0]?.id === ignoreId) return slug;
    slug = `${slugify(base).slice(0, 70)}-${n}`;
    n += 1;
  }
}


/* t69 follow-up: revisions-lite, admin action log, aggregated 404 log.
   Tables come from migration 0011; ensureFollowupTables also creates them
   if missing so the app never breaks before the migration is applied. */
let followupReady = false;
export async function ensureFollowupTables(): Promise<void> {
  if (followupReady) return;
  const sql = await getSql();
  await sql`create table if not exists article_revisions (id text primary key, article_id text not null, saved_at text not null, title text not null default '', status text not null default '', snapshot text not null)`;
  await sql`create table if not exists admin_actions (id text primary key, created_at text not null, kind text not null, summary text not null)`;
  await sql`create table if not exists not_found_log (path text primary key, referrer text not null default '', hits integer not null default 1, first_seen text not null, last_seen text not null)`;
  followupReady = true;
}

type RevisionRow = { id: string; saved_at: string; title: string; status: string };

export async function listRevisions(articleId: string): Promise<Array<{ id: string; savedAt: string; title: string; status: string }>> {
  await ensureFollowupTables().catch(() => undefined);
  const sql = await getSql();
  const rows = await sql<RevisionRow>`select id, saved_at, title, status from article_revisions where article_id = ${articleId} order by saved_at desc limit ${REVISION_KEEP}`.catch(() => [] as RevisionRow[]);
  return rows.map((r) => ({ id: r.id, savedAt: r.saved_at, title: r.title, status: r.status }));
}

async function archiveRevision(sql: Sql, articleId: string): Promise<void> {
  const rows = await sql<Record<string, unknown>>`select slug, title, excerpt, status, category_id, motif, featured, seo_title, seo_description, cover_media_id, blocks, scheduled_at from articles where id = ${articleId}`;
  const row = rows[0];
  if (!row) return;
  const tagRows = await sql<{ tag_id: string }>`select tag_id from article_tags where article_id = ${articleId}`.catch(() => [] as Array<{ tag_id: string }>);
  let topicIds: string[] = [String(row.category_id ?? "")];
  try {
    const topicRows = await sql<{ category_id: string }>`select category_id from article_topics where article_id = ${articleId}`;
    if (topicRows.length) topicIds = topicRows.map((t) => t.category_id);
  } catch { /* pre-0007 db: single topic */ }
  let blocks: unknown[] = [];
  try { blocks = JSON.parse(String(row.blocks ?? "[]")) as unknown[]; } catch { blocks = []; }
  const snapshot: RevisionSnapshot = {
    v: 1,
    title: String(row.title ?? ""),
    excerpt: String(row.excerpt ?? ""),
    categoryId: String(row.category_id ?? ""),
    topicIds,
    tagIds: tagRows.map((t) => t.tag_id),
    motif: String(row.motif ?? "signal-grid"),
    featured: Boolean(row.featured),
    seoTitle: String(row.seo_title ?? ""),
    seoDescription: String(row.seo_description ?? ""),
    coverMediaId: String(row.cover_media_id ?? ""),
    blocks,
    scheduledAt: row.scheduled_at ? String(row.scheduled_at) : null,
  };
  const now = new Date().toISOString();
  await sql`insert into article_revisions (id, article_id, saved_at, title, status, snapshot) values (${randomUUID()}, ${articleId}, ${now}, ${snapshot.title}, ${String(row.status ?? "")}, ${JSON.stringify(snapshot)})`;
  await sql`delete from article_revisions where article_id = ${articleId} and id not in (select id from article_revisions where article_id = ${articleId} order by saved_at desc limit ${REVISION_KEEP})`;
}

/** Restore a revision's content into the article. Current content is archived
 *  first (via saveArticle), so a restore is itself undoable. Publish status
 *  and slug never change on restore. */
export async function restoreRevision(revisionId: string): Promise<{ id: string; slug: string }> {
  await ensureFollowupTables();
  const sql = await getSql();
  const rows = await sql<{ article_id: string; snapshot: string }>`select article_id, snapshot from article_revisions where id = ${revisionId}`;
  const rev = rows[0];
  if (!rev) throw new ContentError("That revision no longer exists.", 404);
  const current = await sql<{ slug: string }>`select slug from articles where id = ${rev.article_id}`;
  if (!current[0]) throw new ContentError("That article no longer exists.", 404);
  const snapshot = JSON.parse(rev.snapshot) as RevisionSnapshot;
  const saved = await saveArticle(buildRestoreInput(rev.article_id, current[0].slug, snapshot));
  return { id: saved.id, slug: saved.slug };
}

export async function logAdminAction(kind: string, summary: string): Promise<void> {
  try {
    await ensureFollowupTables();
    const sql = await getSql();
    await sql`insert into admin_actions (id, created_at, kind, summary) values (${randomUUID()}, ${new Date().toISOString()}, ${kind.slice(0, 40)}, ${summary.slice(0, 200)})`;
    await sql`delete from admin_actions where id not in (select id from admin_actions order by created_at desc limit 200)`;
  } catch { /* logging must never break the action it describes */ }
}

export async function activityFeed(): Promise<Array<{ at: string; source: "You" | "Automation"; text: string }>> {
  await ensureFollowupTables().catch(() => undefined);
  const sql = await getSql();
  const admin = await sql<{ created_at: string; summary: string }>`select created_at, summary from admin_actions order by created_at desc limit 40`.catch(() => [] as Array<{ created_at: string; summary: string }>);
  let automation: Array<{ at: string; text: string }> = [];
  try {
    const { recentRuns } = await import("./automation.server");
    const runs = await recentRuns(25);
    automation = runs.map((r) => ({
      at: r.createdAt,
      text: `${r.profileId} · ${r.tool} — ${r.outcome}${r.reason ? `: ${r.reason}` : ""}`,
    }));
  } catch { /* automation table unavailable */ }
  return mergeActivityFeed(admin.map((a) => ({ at: a.created_at, text: a.summary })), automation, 50);
}

export async function recordNotFound(rawPath: unknown, referrer = ""): Promise<void> {
  const path = sanitizeNotFoundPath(rawPath);
  if (!path) return;
  try {
    await ensureFollowupTables();
    const sql = await getSql();
    const now = new Date().toISOString();
    const ref = referrer.slice(0, 300);
    await sql`insert into not_found_log (path, referrer, hits, first_seen, last_seen) values (${path}, ${ref}, 1, ${now}, ${now}) on conflict(path) do update set hits = hits + 1, last_seen = ${now}, referrer = case when ${ref} <> '' then ${ref} else referrer end`;
    await sql`delete from not_found_log where path not in (select path from not_found_log order by last_seen desc limit 5000)`;
  } catch { /* 404 logging is best-effort */ }
}

export async function listNotFounds(limit = 12): Promise<Array<{ path: string; hits: number; lastSeen: string; referrer: string }>> {
  await ensureFollowupTables().catch(() => undefined);
  const sql = await getSql();
  const rows = await sql<{ path: string; hits: number; last_seen: string; referrer: string }>`select path, hits, last_seen, referrer from not_found_log order by hits desc limit ${limit}`.catch(() => [] as Array<{ path: string; hits: number; last_seen: string; referrer: string }>);
  return rows.map((r) => ({ path: r.path, hits: Number(r.hits), lastSeen: r.last_seen, referrer: r.referrer }));
}

export async function saveArticle(raw: unknown): Promise<{ id: string; slug: string; status: PublicationStatus }> {
  const input: ArticleWrite = articleWriteSchema.parse(raw);
  if (input.intent === "publish") {
    const problem = publishProblems(input);
    if (problem) throw new ContentError(problem);
  }
  await ensureContent();
  await ensureFollowupTables().catch(() => undefined);
  if (input.coverMediaId) {
    const library = await openMediaStore();
    if (!(await library.exists(input.coverMediaId))) throw new ContentError("That cover image is not in the library.");
  }
  return withTransaction(async (sql) => {
    const topicIds = [...new Set(input.topicIds?.length ? input.topicIds : [input.categoryId])];
    const knownTopics = await sql.query<{ id: string }>(
      `select id from categories where id in (${topicIds.map((_, i) => `$${i + 1}`).join(", ")})`,
      topicIds,
    );
    if (knownTopics.length !== topicIds.length) throw new ContentError("One of the topics no longer exists. Choose from the current topic list.");
    const categoryId = topicIds[0];
    const knownTags = input.tagIds.length
      ? await sql.query<{ id: string }>(
          `select id from tags where id in (${input.tagIds.map((_, i) => `$${i + 1}`).join(", ")})`,
          input.tagIds,
        )
      : [];
    if (knownTags.length !== input.tagIds.length) throw new ContentError("One of the tags no longer exists.");

    const existing = input.id
      ? await sql<{ id: string; status: PublicationStatus; published_at: string | Date | null }>`
          select id, status, published_at from articles where id = ${input.id}
        `
      : [];
    if (input.id && existing.length === 0) throw new ContentError("That article no longer exists.", 404);

    const id = input.id ?? randomUUID();
    const slug = await uniqueSlug(sql, input.slug || input.title, id);
    const previous = existing[0];
    let status: PublicationStatus = previous?.status ?? "draft";
    let publishedAt = iso(previous?.published_at ?? null);
    if (input.intent === "publish") {
      status = "published";
      publishedAt = input.publishedAt ?? publishedAt ?? new Date().toISOString();
    } else if (input.intent === "unpublish") {
      status = "unpublished";
    } else if (input.publishedAt && status === "published") {
      publishedAt = input.publishedAt;
    }
    const seoTitle = input.seoTitle || null;
    const seoDescription = input.seoDescription || null;
    const scheduledAt = status === "draft" ? (input.scheduledAt ?? null) : null;
    const blocks = JSON.stringify(input.blocks);
    const now = new Date().toISOString();

    if (previous) {
      await archiveRevision(sql, id).catch(() => undefined);
      await sql`update articles set
        slug = ${slug},
        title = ${input.title},
        excerpt = ${input.excerpt},
        status = ${status},
        published_at = ${publishedAt},
        updated_at = ${now},
        category_id = ${categoryId},
        motif = ${input.motif},
        featured = ${input.featured},
        seo_title = ${seoTitle},
        seo_description = ${seoDescription},
        cover_media_id = ${input.coverMediaId},
        scheduled_at = ${scheduledAt},
        blocks = ${blocks}::jsonb
        where id = ${id}`;
    } else {
      await sql`insert into articles (
        id, slug, title, excerpt, status, published_at, updated_at, category_id, motif, featured,
        seo_title, seo_description, cover_media_id, blocks, scheduled_at
      ) values (
        ${id}, ${slug}, ${input.title}, ${input.excerpt}, ${status}, ${publishedAt}, ${now},
        ${categoryId}, ${input.motif}, ${input.featured}, ${seoTitle}, ${seoDescription},
        ${input.coverMediaId}, ${blocks}::jsonb, ${scheduledAt}
      )`;
    }
    if (input.featured) {
      await sql`update articles set featured = false where id <> ${id} and featured = true`;
    }
    await sql`delete from article_tags where article_id = ${id}`;
    for (const tagId of input.tagIds) {
      await sql`insert into article_tags (article_id, tag_id) values (${id}, ${tagId})`;
    }
    try {
      await sql`delete from article_topics where article_id = ${id}`;
      for (const topicId of topicIds) {
        await sql`insert into article_topics (article_id, category_id) values (${id}, ${topicId})`;
      }
    } catch {
      throw new ContentError("Multiple topics need database migration 0007 (article_topics). Apply it to this database first.");
    }
    return { id, slug, status };
  });
}

export async function deleteDraft(id: string): Promise<void> {
  await ensureContent();
  const sql = await getSql();
  const rows = await sql<{ status: PublicationStatus }>`select status from articles where id = ${id}`;
  if (rows.length === 0) throw new ContentError("That article no longer exists.", 404);
  if (rows[0]?.status === "published") throw new ContentError("Unpublish the article before deleting it.");
  await sql`delete from articles where id = ${id}`;
}

/**
 * Deletes an article in any status (published included). Removes its tag links
 * and automation bookkeeping rows. The cover image file is kept unless
 * `deleteCover` is set AND nothing else (another article, logo, favicon) uses it.
 */
export async function deleteArticle(id: string, options: { deleteCover?: boolean } = {}): Promise<{ coverDeleted: boolean }> {
  await ensureContent();
  const sql = await getSql();
  const rows = await sql<{ cover_media_id: string | null }>`select cover_media_id from articles where id = ${id}`;
  if (rows.length === 0) throw new ContentError("That article no longer exists.", 404);
  const cover = rows[0]?.cover_media_id ?? null;
  await sql`delete from article_tags where article_id = ${id}`;
  await sql`delete from article_topics where article_id = ${id}`.catch(() => undefined);
  await sql`delete from automation_submissions where article_id = ${id}`.catch(() => undefined);
  await sql`delete from articles where id = ${id}`;
  let coverDeleted = false;
  if (options.deleteCover && cover) {
    try {
      await deleteMedia(cover);
      coverDeleted = true;
    } catch (error) {
      if (!(error instanceof ContentError)) throw error; // still in use elsewhere: keep the file
    }
  }
  return { coverDeleted };
}

// ---- AI (MCP) article editing ---------------------------------------------------
// Server-side guard shared by every AI editing tool. Ownership = the profile
// that created the automation submission (null = owner-created in admin).

export type { AiActor };

async function aiOwnerProfileId(sql: Sql, articleId: string): Promise<string | null> {
  try {
    const rows = await sql<{ profile_id: string | null }>`select profile_id from automation_submissions where article_id = ${articleId} limit 1`;
    return rows.length ? (rows[0].profile_id ?? "default") : null;
  } catch {
    return null; // no submissions table: treat as owner-created
  }
}

/** Ids of articles with the admin AI-edit grant. Empty until migration 0006 is applied. */
export async function aiEditGrantIds(): Promise<Set<string>> {
  try {
    const sql = await getSql();
    const rows = await sql<{ id: string }>`select id from articles where ai_edit_allowed = 1`;
    return new Set(rows.map((r) => r.id));
  } catch {
    return new Set();
  }
}

export async function setAiEditAllowed(id: string, allowed: boolean): Promise<void> {
  await ensureContent();
  const sql = await getSql();
  const rows = await sql<{ id: string }>`select id from articles where id = ${id}`;
  if (rows.length === 0) throw new ContentError("That article no longer exists.", 404);
  try {
    await sql`update articles set ai_edit_allowed = ${allowed ? 1 : 0} where id = ${id}`;
  } catch {
    throw new ContentError("AI edit grants need database migration 0006 (articles.ai_edit_allowed). Apply it to this database first.");
  }
}

export type AiArticleAccess = { article: Article; ownerProfileId: string | null; viaGrant: boolean };

async function loadAiArticle(articleId: string): Promise<{ article: Article; ownerProfileId: string | null }> {
  const data = await catalog();
  const article = data.articles.find((a) => a.id === articleId);
  if (!article) throw new ContentError("That article no longer exists.", 404);
  const grants = await aiEditGrantIds();
  article.aiEditAllowed = grants.has(article.id);
  const sql = await getSql();
  return { article, ownerProfileId: await aiOwnerProfileId(sql, articleId) };
}

function guardOrThrow(article: Article, ownerProfileId: string | null, actor: AiActor, action: AiEditAction): { viaGrant: boolean } {
  try {
    return assertAiCanAccess(article, ownerProfileId, actor, action);
  } catch (error) {
    throw new ContentError(error instanceof Error ? error.message : "That article is locked for AI editing.", 403);
  }
}

/** Loads an article and enforces the AI access rules for the given action. */
export async function getArticleForAi(articleId: string, actor: AiActor, action: AiEditAction): Promise<AiArticleAccess> {
  const { article, ownerProfileId } = await loadAiArticle(articleId);
  const { viaGrant } = guardOrThrow(article, ownerProfileId, actor, action);
  return { article, ownerProfileId, viaGrant };
}

export type AiArticlePatch = {
  title?: string;
  slug?: string;
  excerpt?: string;
  categoryId?: string;
  topicIds?: string[];
  tagIds?: string[];
  seoTitle?: string;
  seoDescription?: string;
  coverMediaId?: string | null;
  blocks?: ArticleBlock[];
};

/**
 * Applies a partial patch to an AI-editable article. Id, status, published_at,
 * motif and featured are always preserved — editing never publishes,
 * unpublishes or deletes. Reuses saveArticle validation ("save" intent).
 */
export async function updateArticleForAi(articleId: string, patch: AiArticlePatch, actor: AiActor): Promise<AiArticleAccess & { updated: Article }> {
  const { article, ownerProfileId } = await loadAiArticle(articleId);
  const { viaGrant } = guardOrThrow(article, ownerProfileId, actor, patch.coverMediaId !== undefined ? "cover" : "edit");
  try {
    assertAiPatchAllowed(article, patch, viaGrant);
  } catch (error) {
    throw new ContentError(error instanceof Error ? error.message : "That change is not allowed.", 403);
  }
  if (patch.slug && patch.slug !== article.slug) {
    const sql = await getSql();
    const clash = await sql<{ id: string }>`select id from articles where slug = ${patch.slug} and id <> ${articleId} limit 1`;
    if (clash.length) throw new ContentError(`The slug “${patch.slug}” is already used by another article. Choose a different slug.`);
  }
  const saved = await saveArticle({
    id: article.id,
    title: patch.title ?? article.title,
    slug: patch.slug ?? article.slug,
    excerpt: patch.excerpt ?? article.excerpt,
    categoryId: patch.topicIds?.[0] ?? patch.categoryId ?? article.categoryId,
    topicIds: patch.topicIds ?? article.topicIds,
    tagIds: patch.tagIds ?? article.tagIds,
    motif: article.motif,
    featured: article.featured,
    seoTitle: patch.seoTitle ?? article.seoTitle ?? "",
    seoDescription: patch.seoDescription ?? article.seoDescription ?? "",
    coverMediaId: patch.coverMediaId !== undefined ? patch.coverMediaId : (article.coverMediaId ?? null),
    publishedAt: article.publishedAt,
    blocks: patch.blocks ?? article.blocks,
    intent: "save",
  });
  const data = await catalog();
  const updated = data.articles.find((a) => a.id === saved.id) ?? article;
  updated.aiEditAllowed = article.aiEditAllowed;
  return { article, ownerProfileId, viaGrant, updated };
}

/** Hard-deletes a draft/unpublished article for AI. Published is always refused, grant or not. Cover media mirrors admin deleteArticle. */
export async function deleteArticleForAi(articleId: string, actor: AiActor, options: { deleteCoverIfUnused?: boolean } = {}): Promise<{ slug: string; coverDeleted: boolean }> {
  const { article } = await loadAiArticle(articleId);
  const sql = await getSql();
  const ownerProfileId = await aiOwnerProfileId(sql, articleId);
  guardOrThrow(article, ownerProfileId, actor, "delete");
  const { coverDeleted } = await deleteArticle(articleId, { deleteCover: options.deleteCoverIfUnused ?? false });
  return { slug: article.slug, coverDeleted };
}

// ---- Admin: delete old articles -------------------------------------------------
// Admin-panel only (never exposed to MCP/AI). Preview and delete share the
// same pure matcher, and deletion re-runs the matcher server-side at delete
// time, then deletes through the same deleteArticle used by single delete
// (tag links + bookkeeping removed; cover files stay in Media unless the
// single-delete cover option is used — bulk delete always keeps them).

export async function previewOldArticles(query: OldArticleQuery) {
  const data = await catalog();
  const now = new Date();
  const matches = filterOldArticles(data.articles, query, now);
  return { cutoff: cutoffFor(query, now).toISOString(), total: matches.length, articles: matches.slice(0, 100) };
}

export async function deleteOldArticles(query: OldArticleQuery): Promise<{ deleted: { id: string; slug: string; title: string; status: string }[]; total: number }> {
  const data = await catalog();
  const matches = filterOldArticles(data.articles, query, new Date());
  const deleted: { id: string; slug: string; title: string; status: string }[] = [];
  for (const match of matches) {
    await deleteArticle(match.id);
    deleted.push({ id: match.id, slug: match.slug, title: match.title, status: match.status });
  }
  return { deleted, total: deleted.length };
}

export async function saveCategory(raw: unknown): Promise<{ id: string }> {
  const input = categoryWriteSchema.parse(raw);
  await ensureContent();
  const sql = await getSql();
  const slug = await uniqueTaxonomySlug(sql, "categories", input.slug || input.label, input.id);
  if (input.id) {
    const current = await sql`select id from categories where id = ${input.id}`;
    if (current.length === 0) throw new ContentError("That topic is gone.", 404);
    await sql`update categories set slug = ${slug}, label = ${input.label}, description = ${input.description} where id = ${input.id}`;
    return { id: input.id };
  }
  const id = slug;
  await sql`insert into categories (id, slug, label, description) values (${id}, ${slug}, ${input.label}, ${input.description})`;
  return { id };
}

export async function deleteCategory(id: string): Promise<void> {
  await ensureContent();
  const sql = await getSql();
  const used = await sql<{ n: number }>`select count(*)::int as n from articles where category_id = ${id}`;
  const linked = await sql<{ n: number }>`select count(*)::int as n from article_topics where category_id = ${id}`.catch(() => [{ n: 0 }]);
  if (Number(used[0]?.n ?? 0) > 0 || Number(linked[0]?.n ?? 0) > 0) throw new ContentError("Move the articles in this topic to another topic before deleting it.");
  const result = await sql`delete from categories where id = ${id} returning id`;
  if (result.length === 0) throw new ContentError("That topic is gone.", 404);
}

export async function saveTag(raw: unknown): Promise<{ id: string }> {
  const input = tagWriteSchema.parse(raw);
  await ensureContent();
  const sql = await getSql();
  const slug = await uniqueTaxonomySlug(sql, "tags", input.slug || input.label, input.id);
  if (input.id) {
    const current = await sql`select id from tags where id = ${input.id}`;
    if (current.length === 0) throw new ContentError("That tag is gone.", 404);
    await sql`update tags set slug = ${slug}, label = ${input.label} where id = ${input.id}`;
    return { id: input.id };
  }
  const id = slug;
  await sql`insert into tags (id, slug, label) values (${id}, ${slug}, ${input.label})`;
  return { id };
}

export async function deleteTag(id: string): Promise<void> {
  await ensureContent();
  const sql = await getSql();
  const used = await sql<{ n: number }>`select count(*)::int as n from article_tags where tag_id = ${id}`;
  if (Number(used[0]?.n ?? 0) > 0) throw new ContentError("Remove this tag from its articles before deleting it.");
  const result = await sql`delete from tags where id = ${id} returning id`;
  if (result.length === 0) throw new ContentError("That tag is gone.", 404);
}

async function uniqueTaxonomySlug(sql: Sql, table: "categories" | "tags", base: string, ignoreId: string | null) {
  let slug = slugify(base);
  let n = 2;
  for (;;) {
    const rows = await sql.query<{ id: string }>(`select id from ${table} where slug = $1`, [slug]);
    if (rows.length === 0 || rows[0]?.id === ignoreId) return slug;
    slug = `${slugify(base).slice(0, 70)}-${n}`;
    n += 1;
  }
}

export async function readSettings() {
  const data = await catalog();
  const live = published(data.articles);
  return { site: data.site, articles: live.map((article) => ({ slug: article.slug, title: article.title })) };
}

export async function saveSettings(raw: unknown): Promise<void> {
  const next = parseSite(raw);
  await ensureContent();
  if (next.logoMediaId || next.faviconMediaId) {
    const library = await openMediaStore();
    if (next.logoMediaId && !(await library.exists(next.logoMediaId))) {
      throw new ContentError("The logo image is not in the library.");
    }
    if (next.faviconMediaId && !(await library.exists(next.faviconMediaId))) {
      throw new ContentError("The favicon image is not in the library.");
    }
  }
  const sql = await getSql();
  const known = new Set(published(await loadArticles(sql)).map((article) => article.slug));
  // Trending may point at published slugs only. Drop unknown ones rather than storing dead links.
  next.trending.slugs = next.trending.slugs.filter((slug) => known.has(slug));
  await sql`update site_settings set data = ${JSON.stringify(next)}::jsonb where id = 'site'`;
}

export type MediaItem = {
  id: string;
  filename: string;
  mime: string;
  alt: string;
  bytes: number;
  createdAt: string;
  heroBytes: number;
  thumbBytes: number;
  width: number;
  height: number;
  processing: string;
  hasVariants: boolean;
};

export async function listMedia(): Promise<Array<MediaItem & { usedAsCover: boolean }>> {
  const library = await openMediaStore();
  const items = await library.list();
  let covers = new Set<string>();
  try {
    const sql = await getSql();
    const rows = await sql<{ cover_media_id: string | null }>`select distinct cover_media_id from articles where cover_media_id is not null`;
    covers = new Set(rows.map((r) => r.cover_media_id).filter((v): v is string => Boolean(v)));
  } catch { /* articles table unavailable: everything reads unused */ }
  return items.map((m) => ({ ...m, usedAsCover: covers.has(m.id) }));
}

export type UploadMediaResult = {
  id: string;
  image: {
    width: number;
    height: number;
    heroBytes: number;
    thumbBytes: number;
    processing: string;
    warnings: string[];
  };
};

/**
 * The single upload path (t60): admin manual uploads and the MCP
 * upload_featured_image tool (base64 and URL-fetch) all land here.
 * Bytes are validated (10 MB cap + magic-byte match in decodeImage,
 * dimension/pixel guards in the pipeline), optimized once via the
 * IMAGES binding, and stored as hero+thumb variants. Any pipeline
 * failure throws before anything is stored — no partial media.
 */
export async function uploadMedia(raw: unknown): Promise<UploadMediaResult> {
  const input = mediaWriteSchema.parse(raw);
  const bytes = decodeImage(input.dataBase64, input.mime);
  return uploadMediaBytes({ filename: input.filename, mime: input.mime, alt: input.alt, bytes });
}

export async function uploadMediaBytes(input: {
  filename: string;
  mime: string;
  alt: string;
  bytes: Uint8Array;
}): Promise<UploadMediaResult> {
  const { processUploadImage } = await import("@/lib/image-pipeline.server");
  const { ImagePipelineError } = await import("@/lib/image-pipeline");
  let processed;
  try {
    processed = await processUploadImage(new Uint8Array(input.bytes));
  } catch (error) {
    if (error instanceof ImagePipelineError) {
      throw new ContentError(error.message, error.code === "quota-exceeded" || error.code === "binding-missing" ? 503 : 400);
    }
    throw error;
  }
  const library = await openMediaStore();
  const id = randomUUID();
  const filename = input.filename.replace(/[/\\]/g, "").slice(0, 120);
  const reuseHeroAsThumb = processed.processing === "original-within-target";
  await library.putProcessed({
    id,
    filename,
    mime: input.mime,
    alt: input.alt,
    originalByteSize: input.bytes.byteLength,
    hero: {
      bytes: processed.hero.bytes,
      contentType: processed.hero.contentType,
      width: processed.hero.width,
      height: processed.hero.height,
    },
    thumb: reuseHeroAsThumb ? null : { bytes: processed.thumb.bytes, contentType: processed.thumb.contentType },
    processing: processed.processing,
    createdAt: new Date().toISOString(),
  });
  return {
    id,
    image: {
      width: processed.hero.width,
      height: processed.hero.height,
      heroBytes: processed.hero.bytes.byteLength,
      thumbBytes: reuseHeroAsThumb ? 0 : processed.thumb.bytes.byteLength,
      processing: processed.processing,
      warnings: processed.warnings,
    },
  };
}

export type MediaBackfillReport = {
  dryRun: boolean;
  scanned: number;
  processed: number;
  skipped: number;
  transformsUsed: number;
  failures: { id: string; filename: string; error: string }[];
};

/**
 * Legacy backfill (t60): generate hero+thumb variants for media rows
 * uploaded before the pipeline existed. Dry-run by default; batches
 * are bounded; rows that already have variants are skipped, so
 * re-running is safe (idempotent). Failures are reported per item and
 * never leave partial objects behind (recordVariants cleans up).
 * Quota errors stop the batch early with the failures recorded.
 */
export async function backfillMediaVariants(raw: { apply?: boolean; limit?: number } = {}): Promise<MediaBackfillReport> {
  const apply = raw.apply === true;
  const limit = Math.max(1, Math.min(25, Math.floor(raw.limit ?? 10) || 10));
  const library = await openMediaStore();
  const legacy = await library.legacyBatch(limit);
  const report: MediaBackfillReport = {
    dryRun: !apply,
    scanned: legacy.length,
    processed: 0,
    skipped: 0,
    transformsUsed: 0,
    failures: [],
  };
  if (!apply) return report;
  const { processUploadImage } = await import("@/lib/image-pipeline.server");
  for (const item of legacy) {
    try {
      const original = await library.read(item.id);
      if (!original) {
        report.failures.push({ id: item.id, filename: item.filename, error: "Original object is missing from R2." });
        continue;
      }
      const processed = await processUploadImage(original.bytes);
      const reuseHeroAsThumb = processed.processing === "original-within-target";
      const done = await library.recordVariants({
        id: item.id,
        hero: {
          bytes: processed.hero.bytes,
          contentType: processed.hero.contentType,
          width: processed.hero.width,
          height: processed.hero.height,
        },
        thumb: reuseHeroAsThumb ? null : { bytes: processed.thumb.bytes, contentType: processed.thumb.contentType },
        processing: processed.processing === "images-binding" ? "backfill-images-binding" : processed.processing,
      });
      report.transformsUsed += processed.transformCalls;
      if (done) report.processed += 1;
      else report.skipped += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.failures.push({ id: item.id, filename: item.filename, error: message });
      if (/quota/i.test(message)) break; // stop early: later items would fail the same way
    }
  }
  return report;
}

export async function deleteMedia(id: string): Promise<void> {
  await ensureContent();
  const sql = await getSql();
  const used = await sql<{ n: number }>`select count(*)::int as n from articles where cover_media_id = ${id}`;
  if (Number(used[0]?.n ?? 0) > 0) throw new ContentError("This image is a cover. Remove it from that article first.");
  const settings = await sql<{ data: SiteConfig | string }>`select data from site_settings where id = 'site'`;
  const config = normalizeSite(typeof settings[0]?.data === "string" ? JSON.parse(settings[0].data) : settings[0]?.data);
  if (config.logoMediaId === id || config.faviconMediaId === id) {
    throw new ContentError("This image is used as the logo or favicon. Clear it in settings first.");
  }
  const library = await openMediaStore();
  const removed = await library.remove(id);
  if (!removed) throw new ContentError("That file is gone.", 404);
}

export async function readMediaFile(
  id: string,
  variant: "hero" | "thumb" = "hero",
): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const library = await openMediaStore();
  return library.read(id, variant);
}
