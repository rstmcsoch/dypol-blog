import { getSql } from "@/lib/db";
import {
  defaultLayout,
  layoutDocSchema,
  newBlock,
  parseLayout,
  type Area,
  type Block,
  type LayoutDoc,
} from "@/lib/layout/blocks";
import type { Category, SiteConfig, Tag } from "./types";
import { relatedArticles, publicSnapshot, selectArticlesWithNote, type SelectedArticle } from "./repository.server";

/**
 * Storage and resolution for the homepage/sidebar layouts.
 *
 * Two rows in the existing site_settings table:
 *   'layout'        the published layout the public site renders
 *   'layout:draft'  the version being edited in the desk
 *
 * Publishing copies draft → published, so an edit never reaches visitors until
 * the owner publishes it. When no published row exists (an older deployment, or
 * a fresh database) the legacy `site.home.sections` / `site.articleSidebar`
 * settings are converted into an equivalent layout, so the homepage can never
 * be blank and nothing the owner already set is lost.
 */

export const LAYOUT_PUBLISHED = "layout";
export const LAYOUT_DRAFT = "layout:draft";

async function readRow(id: string): Promise<LayoutDoc | null> {
  const sql = await getSql();
  const rows = await sql<{ data: string }>`select data from site_settings where id = ${id}`;
  const raw = rows[0]?.data;
  if (raw === undefined) return null;
  try {
    return parseLayout(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch {
    return null;
  }
}

async function writeRow(id: string, doc: LayoutDoc): Promise<void> {
  const sql = await getSql();
  const payload = JSON.stringify(doc);
  await sql.run("insert into site_settings (id, data) values (?, ?) on conflict (id) do update set data = excluded.data", [id, payload]);
}

async function deleteRow(id: string): Promise<void> {
  const sql = await getSql();
  await sql.run("delete from site_settings where id = ?", [id]);
}

/** The pre-builder homepage/sidebar settings, expressed as blocks. */
export async function legacyLayout(): Promise<LayoutDoc> {
  const { site } = await publicSnapshot();
  return legacyLayoutFrom(site);
}

function legacyLayoutFrom(site: SiteConfig): LayoutDoc {
  const section = (id: string) => site.home.sections.find((item) => item.id === id);
  const enabled = (id: string) => section(id)?.enabled ?? true;
  const count = (id: string, fallback: number) => section(id)?.count ?? fallback;
  const blocks: Block[] = [];
  if (enabled("featured")) {
    blocks.push({ ...(newBlock("hero", "homepage") as Extract<Block, { type: "hero" }>), id: "legacy-hero", heading: "", kicker: site.labels.featured });
  }
  if (enabled("also")) {
    blocks.push({
      ...(newBlock("articleList", "homepage") as Extract<Block, { type: "articleList" }>),
      id: "legacy-also",
      heading: site.labels.also,
      source: "latest",
      count: Math.max(1, Math.min(count("also", 3), 12)),
      style: "grid",
      columns: 3,
      showExcerpt: false,
    });
  }
  if (enabled("latest")) {
    blocks.push({
      ...(newBlock("articleList", "homepage") as Extract<Block, { type: "articleList" }>),
      id: "legacy-latest",
      heading: site.labels.latest,
      source: "latest",
      count: count("latest", 12),
      style: "index",
      viewAll: { label: site.labels.fullIndex, href: "/articles" },
    });
  }
  if (enabled("topics")) {
    blocks.push({
      ...(newBlock("categories", "homepage") as Extract<Block, { type: "categories" }>),
      id: "legacy-topics",
      heading: site.labels.topics,
      count: count("topics", 12),
    });
  }

  const order: Record<string, number> = {};
  site.home.sections.forEach((item, index) => {
    order[item.id] = index;
  });
  const rank: Record<string, number> = { "legacy-hero": order.featured ?? 0, "legacy-also": order.also ?? 1, "legacy-latest": order.latest ?? 2, "legacy-topics": order.topics ?? 3 };
  blocks.sort((a, b) => (rank[a.id] ?? 99) - (rank[b.id] ?? 99));

  const sideBlocks: Block[] = site.articleSidebar.blocks.map((name) => {
    const count = site.articleSidebar.count;
    switch (name) {
      case "tags":
        return { ...(newBlock("articleTags", "sidebar") as Extract<Block, { type: "articleTags" }>), id: `legacy-side-${name}`, heading: site.labels.tags };
      case "related":
        return {
          ...(newBlock("articleList", "sidebar") as Extract<Block, { type: "articleList" }>),
          id: `legacy-side-${name}`,
          heading: site.labels.alsoLike,
          source: "related",
          count,
        };
      case "newStories":
        return {
          ...(newBlock("articleList", "sidebar") as Extract<Block, { type: "articleList" }>),
          id: `legacy-side-${name}`,
          heading: site.labels.newStories,
          source: "latest",
          count,
        };
      default:
        return { ...(newBlock("share", "sidebar") as Extract<Block, { type: "share" }>), id: `legacy-side-${name}`, heading: site.labels.share };
    }
  });

  return layoutDocSchema.parse({
    version: 2,
    homepage: { blocks },
    sidebar: { enabled: site.articleSidebar.enabled, blocks: sideBlocks },
  });
}

export type LayoutState = {
  published: LayoutDoc;
  draft: LayoutDoc | null;
  /** true when nothing has been published yet and the published view is derived. */
  derived: boolean;
  dirty: boolean;
};

export async function readLayoutState(): Promise<LayoutState> {
  const stored = await readRow(LAYOUT_PUBLISHED);
  const draft = await readRow(LAYOUT_DRAFT);
  const published = stored ?? (await legacyLayout());
  return {
    published,
    draft,
    derived: stored === null,
    dirty: Boolean(draft && JSON.stringify(draft) !== JSON.stringify(published)),
  };
}

/** The layout public pages render. Never throws: falls back to the legacy view. */
export async function readPublishedLayout(): Promise<LayoutDoc> {
  try {
    const stored = await readRow(LAYOUT_PUBLISHED);
    if (stored) return stored;
    return await legacyLayout();
  } catch {
    return defaultLayout();
  }
}

export async function saveLayoutDraft(raw: unknown): Promise<LayoutDoc> {
  const doc = layoutDocSchema.parse(raw);
  await writeRow(LAYOUT_DRAFT, doc);
  return doc;
}

export async function publishLayout(): Promise<LayoutDoc> {
  const draft = await readRow(LAYOUT_DRAFT);
  if (!draft) throw new Error("There is no draft layout to publish.");
  await writeRow(LAYOUT_PUBLISHED, draft);
  await deleteRow(LAYOUT_DRAFT);
  return draft;
}

export async function discardLayoutDraft(): Promise<void> {
  await deleteRow(LAYOUT_DRAFT);
}

// ---- resolution -------------------------------------------------------------

export type ResolvedTopic = { category: Category; count: number };
export type ResolvedTag = { tag: Tag; count: number };

export type ResolvedBlock =
  | { kind: "hero"; block: Extract<Block, { type: "hero" }>; article: SelectedArticle | null; note: string }
  | { kind: "articleList"; block: Extract<Block, { type: "articleList" }>; articles: SelectedArticle[]; note: string }
  | { kind: "categories"; block: Extract<Block, { type: "categories" }>; topics: ResolvedTopic[] }
  | { kind: "tags"; block: Extract<Block, { type: "tags" }>; tags: ResolvedTag[] }
  | { kind: "articleTags"; block: Extract<Block, { type: "articleTags" }>; tags: Tag[] }
  | { kind: "share"; block: Extract<Block, { type: "share" }>; shareTitle: string; sharePath: string }
  | { kind: "richText"; block: Extract<Block, { type: "richText" }> }
  | { kind: "announcement"; block: Extract<Block, { type: "announcement" }> };

async function resolveBlock(block: Block, context: LayoutContext): Promise<ResolvedBlock | null> {
  switch (block.type) {
    case "hero": {
      const picked = await selectArticlesWithNote({ source: "featured", limit: 1 });
      const article = picked.articles[0] ?? null;
      return { kind: "hero", block, article, note: picked.note };
    }
    case "articleList": {
      if (block.source === "related") {
        if (!context.articleId) return null;
        const articles = await relatedArticles(context.articleId, block.count);
        return { kind: "articleList", block, articles, note: "" };
      }
      if (block.source === "manual" && block.slugs.length === 0) {
        return { kind: "articleList", block, articles: [], note: "No articles picked yet." };
      }
      const picked = await selectArticlesWithNote({
        source: block.source,
        limit: block.count,
        categoryIds: block.categoryIds,
        tagIds: block.tagIds,
        slugs: block.slugs,
        days: block.days,
        excludeId: context.articleId,
      });
      return { kind: "articleList", block, articles: picked.articles, note: picked.note };
    }
    case "categories": {
      const { categories, articles } = await publicSnapshot();
      const topics = categories
        .map((category) => ({ category, count: articles.filter((article) => article.categoryId === category.id).length }))
        .sort((a, b) => b.count - a.count)
        .slice(0, block.count);
      return { kind: "categories", block, topics };
    }
    case "tags": {
      const { publicTags } = await import("./repository.server");
      const tags = (await publicTags()).slice(0, block.count);
      return { kind: "tags", block, tags };
    }
    case "articleTags": {
      if (!context.articleId) return null;
      const { articles, tags } = await publicSnapshot();
      const article = articles.find((item) => item.id === context.articleId);
      if (!article) return null;
      const list = article.tagIds
        .map((id) => tags.find((tag) => tag.id === id))
        .filter((tag): tag is Tag => Boolean(tag));
      return { kind: "articleTags", block, tags: list };
    }
    case "share":
      return context.articleId && context.articleSlug
        ? { kind: "share", block, shareTitle: context.articleTitle ?? "", sharePath: `/articles/${context.articleSlug}` }
        : null;
    case "richText":
      return block.body.trim() ? { kind: "richText", block } : null;
    case "announcement":
      return block.heading.trim() || block.description.trim() ? { kind: "announcement", block } : null;
    default:
      return null;
  }
}

export type LayoutContext = { articleId?: string; articleSlug?: string; articleTitle?: string };

/** Turns a document into renderable data. Empty blocks are dropped. */
export async function resolveBlocks(doc: LayoutDoc, area: Area, context: LayoutContext = {}): Promise<ResolvedBlock[]> {
  const blocks = area === "homepage" ? doc.homepage.blocks : doc.sidebar.blocks;
  if (area === "sidebar" && !doc.sidebar.enabled) return [];
  const out: ResolvedBlock[] = [];
  for (const block of blocks) {
    if (!block.enabled) continue;
    const resolved = await resolveBlock(block, context);
    if (!resolved) continue;
    if (resolved.kind === "articleList") {
      // An empty list is hidden unless the owner asked for a visible empty state.
      if (resolved.articles.length === 0 && resolved.block.empty === "hide") continue;
      out.push(resolved);
      continue;
    }
    if (resolved.kind === "articleTags" && resolved.tags.length === 0) continue;
    if (resolved.kind === "hero" && !resolved.article) continue;
    if (resolved.kind === "categories" && resolved.topics.length === 0) continue;
    if (resolved.kind === "tags" && resolved.tags.length === 0) continue;
    out.push(resolved);
  }
  return out;
}

export async function readResolvedHomepage(): Promise<{ doc: LayoutDoc; blocks: ResolvedBlock[] }> {
  const doc = await readPublishedLayout();
  return { doc, blocks: await resolveBlocks(doc, "homepage") };
}

export async function readResolvedSidebar(context: { articleId: string; articleSlug: string; articleTitle?: string }): Promise<{ doc: LayoutDoc; blocks: ResolvedBlock[] }> {
  const doc = await readPublishedLayout();
  return { doc, blocks: await resolveBlocks(doc, "sidebar", context) };
}
