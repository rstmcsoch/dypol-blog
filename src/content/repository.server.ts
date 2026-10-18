const randomUUID = () => crypto.randomUUID();
import { articles as seedArticles } from "./articles";
import { readingMinutes, type ArticleMeta } from "./present";
import { MediaBindingError, openMediaStore } from "./media-store.server";
import { site } from "./site";
import { categories as seedCategories, tags as seedTags } from "./taxonomy";
import { tickerEntries } from "./ticker";
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
  // D1/SQLite accepts at most 100 bound variables per statement, so a
  // growing archive must be read in chunks (this broke get_blog_settings
  // and article lists once the article count passed 100).
  const links: { article_id: string; tag_id: string }[] = [];
  for (let start = 0; start < ids.length; start += 50) {
    const chunk = ids.slice(start, start + 50);
    const placeholders = chunk.map((_, index) => `$${index + 1}`).join(", ");
    links.push(
      ...(await sql.query<{ article_id: string; tag_id: string }>(
        `select article_id, tag_id from article_tags where article_id in (${placeholders})`,
        chunk,
      )),
    );
  }
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
  const data = await publicCatalog();
  const live = published(data.articles);
  return { site: data.site, trending: tickerEntries(data.site, live, await viewCounts(data.site)) };
}

export async function readHome(draftSite?: SiteConfig) {
  const data = await publicCatalog();
  const site = draftSite ?? data.site;
  const live = published(data.articles);
  const blocks = resolveBlocks(site.home.blocks, { site, live, categories: data.categories, tags: data.tags, views: await viewCounts(site) }, "home");
  return { blocks, empty: live.length === 0 };
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
  const same = live.filter((item) => item.categoryId === article.categoryId && item.id !== article.id);
  const rest = live.filter((item) => item.id !== article.id && !same.some((picked) => picked.id === item.id));
  const related = [...same, ...rest].slice(0, 3);
  const sidebar = data.site.articleSidebar.enabled
    ? resolveBlocks(data.site.articleSidebar.blocks, { site: data.site, live, categories: data.categories, tags: data.tags, views: await viewCounts(data.site), current: article }, "sidebar")
    : [];
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
    sidebar,
    meta: metaFor(related, live, data.categories),
  };
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
