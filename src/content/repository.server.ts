const randomUUID = () => crypto.randomUUID();
import { articles as seedArticles } from "./articles";
import { readingMinutes, type ArticleMeta } from "./present";
import { MediaBindingError, openMediaStore } from "./media-store.server";
import { site } from "./site";
import { categories as seedCategories, tags as seedTags } from "./taxonomy";
import { resolveTicker, type TickerContext } from "./ticker";
import type { Article, ArticleBlock, Category, CoverMotif, PublicationStatus, SiteConfig, Tag } from "./types";
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

function mapArticle(row: ArticleRow, tagIds: string[]): Article {
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
    tagIds,
    motif: row.motif,
    featured: Boolean(row.featured),
    seoTitle: row.seo_title ?? undefined,
    seoDescription: row.seo_description ?? undefined,
    coverMediaId: row.cover_media_id,
    blocks,
  };
}

async function tagMap(sql: Sql, ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
  const links = await sql.query<{ article_id: string; tag_id: string }>(
    `select article_id, tag_id from article_tags where article_id in (${placeholders})`,
    ids,
  );
  for (const link of links) {
    const list = map.get(link.article_id) ?? [];
    list.push(link.tag_id);
    map.set(link.article_id, list);
  }
  return map;
}

async function loadArticles(sql: Sql, where = "", params: unknown[] = []): Promise<Article[]> {
  const rows = await sql.query<ArticleRow>(
    `select id, slug, title, excerpt, status, published_at, updated_at, category_id, motif, featured,
            seo_title, seo_description, cover_media_id, blocks
     from articles ${where}`,
    params,
  );
  const tags = await tagMap(
    sql,
    rows.map((row) => row.id),
  );
  return rows.map((row) => mapArticle(row, tags.get(row.id) ?? []));
}

function byNewest(a: Article, b: Article): number {
  return Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? "");
}

async function catalog(): Promise<{ articles: Article[]; categories: Category[]; tags: Tag[]; site: SiteConfig }> {
  await ensureContent();
  const sql = await getSql();
  const articles = await loadArticles(sql, "order by updated_at desc");
  const categories = await sql<Category>`select id, slug, label, description from categories order by label asc`;
  const tags = await sql<Tag>`select id, slug, label from tags order by label asc`;
  const settings = await sql<{ data: SiteConfig | string }>`select data from site_settings where id = 'site'`;
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
      minutes: readingMinutes(article),
    };
  }
  return meta;
}

/** View counters are optional: a database without the metric still renders. */
async function viewContext(): Promise<{ views: Map<string, number>; recorded: boolean }> {
  try {
    const { mostViewed, viewTotals } = await import("@/lib/automation/store.server");
    const [recent, totals] = await Promise.all([mostViewed(7, 200), viewTotals()]);
    const views = new Map<string, number>(totals);
    for (const row of recent) views.set(row.articleId, Math.max(views.get(row.articleId) ?? 0, row.views));
    return { views, recorded: views.size > 0 };
  } catch {
    return { views: new Map<string, number>(), recorded: false };
  }
}

/**
 * Published articles plus the real signals the builders and the ticker use:
 * recorded views (empty when the metric is unavailable), category slugs and
 * which articles are marked featured.
 */
export async function publicSnapshotForPreview(): Promise<{
  live: Article[];
  views: Map<string, number>;
  categories: Map<string, string>;
  featured: Set<string>;
}> {
  const data = await publicCatalog();
  const live = published(data.articles);
  const { views } = await viewContext();
  return {
    live,
    views,
    categories: new Map(data.categories.map((category) => [category.id, category.slug])),
    featured: new Set(live.filter((article) => article.featured).map((article) => article.id)),
  };
}

export async function readShell() {
  const data = await publicCatalog();
  const { live, views, categories, featured } = await publicSnapshotForPreview();
  const context: TickerContext = { views, categories, featured };
  const ticker = resolveTicker(data.site, live, context);
  return {
    site: data.site,
    trending: ticker.items,
    trendingNote: ticker.note,
    trendingFallback: ticker.fallback,
  };
}

export async function readHome() {
  const { readResolvedHomepage } = await import("./layout.server");
  const { doc, blocks } = await readResolvedHomepage();
  const data = await publicCatalog();
  const live = published(data.articles);
  return { blocks, empty: live.length === 0, layoutVersion: doc.version };
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
      count: live.filter((article) => article.categoryId === category.id).length,
    })),
  };
}

export async function readTopic(slug: string) {
  const data = await publicCatalog();
  const category = categoryOf(data.categories, slug);
  if (!category) return null;
  const live = published(data.articles).filter((article) => article.categoryId === category.id);
  const all = published(data.articles);
  return { category, articles: live, meta: metaFor(live, all, data.categories) };
}

export async function readArticle(slug: string) {
  const data = await publicCatalog();
  const live = published(data.articles);
  const article = live.find((item) => item.slug === slug);
  if (!article) return null;
  // Count the read (a real popularity signal for Trending/Popular blocks and
  // the ticker). Best effort: a failed count never affects the page.
  await recordArticleView(article.id);
  return await articlePayload(data, article, live);
}

export async function readPreview(id: string) {
  const data = await catalog();
  const article = data.articles.find((item) => item.id === id);
  if (!article) return null;
  const live = published(data.articles);
  return await articlePayload(data, article, live);
}

async function articlePayload(
  data: Awaited<ReturnType<typeof catalog>>,
  article: Article,
  live: Article[],
) {
  const index = live.findIndex((item) => item.id === article.id);
  const same = live.filter((item) => item.categoryId === article.categoryId && item.id !== article.id);
  const rest = live.filter((item) => item.id !== article.id && !same.some((picked) => picked.id === item.id));
  const related = [...same, ...rest].slice(0, 3);
  const sideCount = data.site.articleSidebar.count;
  const alsoLike = [...same, ...rest].slice(0, sideCount);
  const latest = live.filter((item) => item.id !== article.id).slice(0, sideCount);
  return {
    article,
    category: categoryOf(data.categories, article.categoryId) ?? null,
    tags: article.tagIds
      .map((id) => data.tags.find((tag) => tag.id === id))
      .filter((tag): tag is Tag => Boolean(tag)),
    related,
    neighbors: {
      newer: index > 0 ? live[index - 1] : undefined,
      older: index >= 0 ? live[index + 1] : undefined,
    },
    rank: index === -1 ? 0 : index + 1,
    alsoLike: alsoLike.map(({ id, slug, title }) => ({ id, slug, title })),
    latest: latest.map(({ id, slug, title, publishedAt }) => ({ id, slug, title, publishedAt })),
    meta: metaFor(related, live, data.categories),
    /** Rendered by the Sidebar Manager; falls back to the legacy blocks. */
    sidebar: await sidebarBlocks(article),
  };
}

/** Sidebar block resolution for one article. A failure hides the sidebar, never the article. */
async function sidebarBlocks(article: Article): Promise<import("./layout.server").ResolvedBlock[]> {
  try {
    const { readResolvedSidebar } = await import("./layout.server");
    const { blocks } = await readResolvedSidebar({
      articleId: article.id,
      articleSlug: article.slug,
      articleTitle: article.title,
    });
    return blocks;
  } catch (error) {
    console.error("[content] sidebar blocks unavailable; rendering without the sidebar.", error);
    return [];
  }
}

export async function readSitemap() {
  const data = await publicCatalog();
  return {
    articles: published(data.articles).map((article) => article.slug),
    topics: data.categories.map((category) => category.slug),
  };
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
  tagIds: string[];
  featured: boolean;
  hasCover: boolean;
};

export async function adminOverview() {
  const data = await catalog();
  const counts = {
    published: data.articles.filter((article) => article.status === "published").length,
    draft: data.articles.filter((article) => article.status === "draft").length,
    unpublished: data.articles.filter((article) => article.status === "unpublished").length,
    topics: data.categories.length,
    tags: data.tags.length,
  };
  const library = await openMediaStore().catch((error: unknown) => {
    if (error instanceof MediaBindingError) return null;
    throw error;
  });
  const media = library ? await library.stats() : { files: 0, bytes: 0 };
  const recent = [...data.articles]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 6)
    .map((article) => summarize(article, data.categories));
  const attention = data.articles
    .filter((article) => article.status !== "published")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 6)
    .map((article) => summarize(article, data.categories));
  return {
    counts,
    media: { files: media.files, bytes: media.bytes },
    recent,
    attention,
  };
}

function summarize(article: Article, categories: Category[]): ArticleSummary {
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
    tagIds: article.tagIds,
    featured: article.featured,
    hasCover: Boolean(article.coverMediaId),
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
    if (input.categoryId && article.categoryId !== input.categoryId) return false;
    if (input.tagId && !article.tagIds.includes(input.tagId)) return false;
    if (!q) return true;
    return article.title.toLowerCase().includes(q) || article.slug.toLowerCase().includes(q);
  });
  rows = [...rows].sort((a, b) => {
    if (input.sort === "title") return a.title.localeCompare(b.title);
    if (input.sort === "published") return Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? "");
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
  return {
    articles: rows.map((article) => summarize(article, data.categories)),
    categories: data.categories,
    tags: data.tags,
  };
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

export async function saveArticle(raw: unknown): Promise<{ id: string; slug: string; status: PublicationStatus }> {
  const input: ArticleWrite = articleWriteSchema.parse(raw);
  if (input.intent === "publish") {
    const problem = publishProblems(input);
    if (problem) throw new ContentError(problem);
  }
  await ensureContent();
  if (input.coverMediaId) {
    const library = await openMediaStore();
    if (!(await library.exists(input.coverMediaId))) throw new ContentError("That cover image is not in the library.");
  }
  return withTransaction(async (sql) => {
    const category = await sql<{ id: string }>`select id from categories where id = ${input.categoryId}`;
    if (category.length === 0) throw new ContentError("Choose a topic that exists.");
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
    const blocks = JSON.stringify(input.blocks);
    const now = new Date().toISOString();

    if (previous) {
      await sql`update articles set
        slug = ${slug},
        title = ${input.title},
        excerpt = ${input.excerpt},
        status = ${status},
        published_at = ${publishedAt},
        updated_at = ${now},
        category_id = ${input.categoryId},
        motif = ${input.motif},
        featured = ${input.featured},
        seo_title = ${seoTitle},
        seo_description = ${seoDescription},
        cover_media_id = ${input.coverMediaId},
        blocks = ${blocks}::jsonb
        where id = ${id}`;
    } else {
      await sql`insert into articles (
        id, slug, title, excerpt, status, published_at, updated_at, category_id, motif, featured,
        seo_title, seo_description, cover_media_id, blocks
      ) values (
        ${id}, ${slug}, ${input.title}, ${input.excerpt}, ${status}, ${publishedAt}, ${now},
        ${input.categoryId}, ${input.motif}, ${input.featured}, ${seoTitle}, ${seoDescription},
        ${input.coverMediaId}, ${blocks}::jsonb
      )`;
    }
    if (input.featured) {
      await sql`update articles set featured = false where id <> ${id} and featured = true`;
    }
    await sql`delete from article_tags where article_id = ${id}`;
    for (const tagId of input.tagIds) {
      await sql`insert into article_tags (article_id, tag_id) values (${id}, ${tagId})`;
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
  if (Number(used[0]?.n ?? 0) > 0) throw new ContentError("Move the articles in this topic to another topic before deleting it.");
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
  // Keep the owner's pinned list exactly as chosen. A slug that is not published
  // *right now* (unpublished for a rewrite, or a typo) stays in the setting so
  // the choice survives, and the ticker resolves it at render time: it shows the
  // published entries and says in the desk preview when something is missing.
  // Filtering here used to delete the selection silently on any settings save.
  await sql`update site_settings set data = ${JSON.stringify(next)}::jsonb where id = 'site'`;
}

export type MediaItem = {
  id: string;
  filename: string;
  mime: string;
  alt: string;
  bytes: number;
  createdAt: string;
};

export async function listMedia(): Promise<MediaItem[]> {
  const library = await openMediaStore();
  return library.list();
}

export async function uploadMedia(raw: unknown): Promise<{ id: string }> {
  const input = mediaWriteSchema.parse(raw);
  const bytes = decodeImage(input.dataBase64, input.mime);
  const library = await openMediaStore();
  const id = randomUUID();
  const filename = input.filename.replace(/[/\\]/g, "").slice(0, 120);
  await library.put({
    id,
    filename,
    mime: input.mime,
    alt: input.alt,
    bytes,
    createdAt: new Date().toISOString(),
  });
  return { id };
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

export async function readMediaFile(id: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const library = await openMediaStore();
  return library.read(id);
}

/**
 * Publishes an automation draft only if it is still a draft, and reports
 * whether this call is the one that did it. Fixes the race where two callers
 * both reported a publish (the second updated zero rows).
 */
export async function publishDraftIfStillDraft(id: string): Promise<boolean> {
  await ensureContent();
  const sql = await getSql();
  const now = new Date().toISOString();
  const result = await sql.run(
    "update articles set status = 'published', published_at = ?, updated_at = ? where id = ? and status = 'draft'",
    [now, now, id],
  );
  return result.changes > 0;
}

/** Attaches a cover to a draft (used by the automation pipeline and the MCP tools). */
export async function attachCoverToDraft(id: string, mediaId: string): Promise<boolean> {
  await ensureContent();
  const sql = await getSql();
  const result = await sql.run("update articles set cover_media_id = ?, updated_at = ? where id = ? and status = 'draft'", [
    mediaId,
    new Date().toISOString(),
    id,
  ]);
  return result.changes > 0;
}

export async function readSiteIdentity(): Promise<{ name: string; description: string }> {
  const data = await publicCatalog();
  return { name: data.site.name, description: data.site.description };
}

export type ArticleSelection = {
  source: "latest" | "trending" | "popular" | "featured" | "updated" | "category" | "tag" | "manual";
  limit: number;
  categoryIds?: string[];
  tagIds?: string[];
  slugs?: string[];
  /** Trending only: how many days back to count. */
  days?: number;
  /** Exclude this article (used by the sidebar's related lists). */
  excludeId?: string;
};

export type SelectedArticle = ArticleSummary & {
  views?: number;
  excerpt: string;
  publishedAt: string | null;
  minutes: number;
  rank: number;
  motif: CoverMotif;
  coverMediaId: string | null;
};

/**
 * Resolves an article block/sidebar selection against published content only.
 * Never returns drafts or unpublished pieces, never repeats an article, and
 * never invents a popularity number: "trending" and "popular" come from the
 * view counters in article_views.
 */
export async function selectArticles(input: ArticleSelection): Promise<SelectedArticle[]> {
  const data = await publicCatalog();
  const live = published(data.articles);
  const rank = (article: Article) => live.findIndex((item) => item.id === article.id);
  const summarise = (article: Article, views?: number): SelectedArticle => ({
    ...summarize(article, data.categories),
    excerpt: article.excerpt,
    publishedAt: article.publishedAt,
    minutes: readingMinutes(article),
    rank: rank(article) + 1,
    motif: article.motif,
    coverMediaId: article.coverMediaId ?? null,
    ...(views === undefined ? {} : { views }),
  });

  const { mostViewed, viewTotals } = await import("@/lib/automation/store.server");
  const mapRanking = async (ranking: { articleId: string; views: number }[]): Promise<SelectedArticle[]> => {
    const byId = new Map(live.map((article) => [article.id, article]));
    return ranking
      .map((item) => {
        const article = byId.get(item.articleId);
        return article ? summarise(article, item.views) : null;
      })
      .filter((item): item is SelectedArticle => item !== null);
  };

  let rows: SelectedArticle[] = [];
  switch (input.source) {
    case "trending": {
      rows = await mapRanking(await mostViewed(input.days ?? 7, Math.max(input.limit * 4, 20)));
      // Honest fallback: a young site with no views yet shows the newest pieces
      // rather than an empty block, and the desk says which source was used.
      if (rows.length === 0) rows = live.slice(0, input.limit).map((article) => summarise(article));
      break;
    }
    case "popular": {
      const totals = await viewTotals();
      rows = live
        .map((article) => summarise(article, totals.get(article.id) ?? 0))
        .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
        .filter((item) => (item.views ?? 0) > 0);
      if (rows.length === 0) rows = live.slice(0, input.limit).map((article) => summarise(article));
      break;
    }
    case "featured": {
      const featured = live.filter((article) => article.featured);
      rows = [...featured, ...live.filter((article) => !article.featured)].map((article) => summarise(article));
      break;
    }
    case "updated": {
      rows = [...live]
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .map((article) => summarise(article));
      break;
    }
    case "category": {
      const ids = new Set(input.categoryIds ?? []);
      rows = live.filter((article) => ids.size === 0 || ids.has(article.categoryId)).map((article) => summarise(article));
      break;
    }
    case "tag": {
      const ids = new Set(input.tagIds ?? []);
      rows = live.filter((article) => ids.size === 0 || article.tagIds.some((tag) => ids.has(tag))).map((article) => summarise(article));
      break;
    }
    case "manual": {
      const bySlug = new Map(live.map((article) => [article.slug, article]));
      rows = (input.slugs ?? [])
        .map((slug) => bySlug.get(slug))
        .filter((article): article is Article => Boolean(article))
        .map((article) => summarise(article));
      break;
    }
    case "latest":
    default:
      rows = live.map((article) => summarise(article));
      break;
  }
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (row.id === input.excludeId) return false;
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .sort((a, b) => (input.source === "latest" || input.source === "trending" ? rankOrder(live, a, b) : 0))
    .slice(0, Math.max(1, input.limit));
}

/**
 * Same as selectArticles, plus a plain-language note when the honest fallback
 * kicked in (for example: no reading data recorded yet, so newest was used).
 * The desk shows this line above a preview; the public site never needs it.
 */
export async function selectArticlesWithNote(
  input: ArticleSelection,
): Promise<{ articles: SelectedArticle[]; note: string }> {
  const articles = await selectArticles(input);
  if (articles.length === 0) return { articles, note: "" };
  if (input.source === "trending") {
    const ranked = articles.some((article) => (article.views ?? 0) > 0);
    return ranked ? { articles, note: "" } : { articles, note: "No reading data recorded yet, so this shows the newest articles." };
  }
  if (input.source === "popular") {
    const ranked = articles.some((article) => (article.views ?? 0) > 0);
    return ranked ? { articles, note: "" } : { articles, note: "No reading data recorded yet, so this shows the newest articles." };
  }
  if (input.source === "featured") {
    const only = articles.every((article) => article.featured);
    return only ? { articles, note: "" } : { articles, note: "Nothing is marked Featured, so the newest articles fill the rest." };
  }
  if (input.source === "manual") {
    const found = articles.length;
    const asked = (input.slugs ?? []).length;
    return found === asked ? { articles, note: "" } : { articles, note: `${asked - found} of the picked article(s) are not published, so they are left out.` };
  }
  return { articles, note: "" };
}

function rankOrder(live: Article[], a: SelectedArticle, b: SelectedArticle): number {
  if ((a.views ?? 0) !== (b.views ?? 0) && (a.views !== undefined || b.views !== undefined)) return (b.views ?? 0) - (a.views ?? 0);
  return live.findIndex((item) => item.id === a.id) - live.findIndex((item) => item.id === b.id);
}

/** Counts one view of a published article. Best effort: never breaks a page. */
export async function recordArticleView(articleId: string): Promise<void> {
  try {
    const { writesAllowed } = await import("@/lib/write-guard.server");
    if (!(await writesAllowed())) return;
    const { recordArticleView: write } = await import("@/lib/automation/store.server");
    await write(articleId);
  } catch {
    // A view counter must never affect the page.
  }
}

/** Published articles, taxonomy and site config in one read (pure, no writes). */
export async function publicSnapshot(): Promise<{
  articles: Article[];
  categories: Category[];
  tags: Tag[];
  site: SiteConfig;
}> {
  const data = await publicCatalog();
  return { articles: published(data.articles), categories: data.categories, tags: data.tags, site: data.site };
}

/** Topics with the number of published articles in each. */
export async function publicTopics(): Promise<{ category: Category; count: number }[]> {
  const { articles, categories } = await publicSnapshot();
  return categories.map((category) => ({
    category,
    count: articles.filter((article) => article.categoryId === category.id).length,
  }));
}

/** Tags actually used by published articles. */
export async function publicTags(): Promise<{ tag: Tag; count: number }[]> {
  const { articles, tags } = await publicSnapshot();
  const counts = new Map<string, number>();
  for (const article of articles) {
    for (const tagId of article.tagIds) counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
  }
  return tags
    .map((tag) => ({ tag, count: counts.get(tag.id) ?? 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.tag.label.localeCompare(b.tag.label));
}

/** Related published articles: same topic first, then shared tags, then newest. */
export async function relatedArticles(articleId: string, limit = 4): Promise<SelectedArticle[]> {
  const data = await publicCatalog();
  const live = published(data.articles);
  const article = live.find((item) => item.id === articleId);
  if (!article) return [];
  const score = (candidate: Article): number => {
    if (candidate.id === article.id) return -1;
    let value = candidate.categoryId === article.categoryId ? 2 : 0;
    value += candidate.tagIds.filter((tag) => article.tagIds.includes(tag)).length;
    return value;
  };
  return live
    .filter((candidate) => candidate.id !== article.id)
    .map((candidate) => ({ candidate, score: score(candidate) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ candidate }) => ({
      ...summarize(candidate, data.categories),
      excerpt: candidate.excerpt,
      publishedAt: candidate.publishedAt,
      minutes: readingMinutes(candidate),
      rank: live.findIndex((item) => item.id === candidate.id) + 1,
      motif: candidate.motif,
      coverMediaId: candidate.coverMediaId ?? null,
    }));
}
