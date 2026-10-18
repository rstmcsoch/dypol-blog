import { z } from "zod";
import { isSafeHref } from "../../content/rules.ts";

/**
 * Homepage and sidebar blocks — one model, two areas.
 *
 * The same block type is reused wherever it makes sense (an article list is an
 * article list), but every block stores its own settings, so a homepage block
 * and a sidebar block never overwrite each other. Areas declare which types
 * they allow, and the desk only offers those.
 */

export const ARTICLE_SOURCES = [
  "latest",
  "trending",
  "popular",
  "featured",
  "updated",
  "category",
  "tag",
  "manual",
  "related",
] as const;
export type ArticleSource = (typeof ARTICLE_SOURCES)[number];

export const ARTICLE_SOURCE_LABELS: Record<ArticleSource, string> = {
  latest: "Latest articles",
  trending: "Trending (most read this week)",
  popular: "Popular (most read all time)",
  featured: "Featured articles",
  updated: "Recently updated",
  category: "Articles in chosen topics",
  tag: "Articles with chosen tags",
  manual: "Articles I pick (in this order)",
  related: "You may also like (related to the article)",
};

export const LAYOUT_STYLES = ["index", "grid", "list"] as const;
export type LayoutStyle = (typeof LAYOUT_STYLES)[number];

export const SPACINGS = ["compact", "normal", "roomy"] as const;
export type Spacing = (typeof SPACINGS)[number];

const text = (max: number) => z.string().trim().max(max);
const safeHref = z
  .string()
  .trim()
  .max(300)
  .refine((value) => value === "" || isSafeHref(value), "Use a site path or an https URL.");

const viewAllSchema = z
  .object({ label: text(40), href: safeHref })
  .nullable()
  .default(null)
  .transform((value) => (value && value.label && value.href ? value : null));

const common = {
  id: z.string().trim().min(1).max(40),
  heading: text(80).default(""),
  description: text(240).default(""),
  enabled: z.boolean().default(true),
  spacing: z.enum(SPACINGS).default("normal"),
  viewAll: viewAllSchema,
};

export const blockSchema = z.discriminatedUnion("type", [
  // A hero for the homepage: the featured article, or the newest.
  z.object({
    ...common,
    type: z.literal("hero"),
    kicker: text(40).default(""),
    showExcerpt: z.boolean().default(true),
    showCover: z.boolean().default(true),
  }),
  // One block that covers every article list the site genuinely supports.
  z.object({
    ...common,
    type: z.literal("articleList"),
    source: z.enum(ARTICLE_SOURCES).default("latest"),
    count: z.number().int().min(1).max(48).default(6),
    style: z.enum(LAYOUT_STYLES).default("index"),
    columns: z.number().int().min(1).max(4).default(3),
    showImages: z.boolean().default(false),
    showExcerpt: z.boolean().default(true),
    showMeta: z.boolean().default(true),
    categoryIds: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    tagIds: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    slugs: z.array(z.string().trim().min(1).max(120)).max(48).default([]),
    days: z.number().int().min(1).max(90).default(7),
    /** When nothing matches: hide the block, or show the heading plus a note. */
    empty: z.enum(["hide", "message"]).default("hide"),
  }),
  z.object({
    ...common,
    type: z.literal("categories"),
    count: z.number().int().min(1).max(30).default(12),
    showCounts: z.boolean().default(true),
    style: z.enum(["cards", "list"]).default("cards"),
  }),
  z.object({
    ...common,
    type: z.literal("tags"),
    count: z.number().int().min(1).max(40).default(12),
  }),
  // The current article's own tags (sidebar).
  z.object({
    ...common,
    type: z.literal("articleTags"),
  }),
  // Share buttons (sidebar).
  z.object({
    ...common,
    type: z.literal("share"),
  }),
  z.object({
    ...common,
    type: z.literal("richText"),
    body: text(4000).default(""),
  }),
  z.object({
    ...common,
    type: z.literal("announcement"),
    tone: z.enum(["accent", "plain"]).default("accent"),
    linkLabel: text(40).default(""),
    href: safeHref.default(""),
  }),
]);

export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block["type"];

export type Area = "homepage" | "sidebar";

export const AREA_TYPES: Record<Area, BlockType[]> = {
  homepage: ["hero", "articleList", "categories", "tags", "announcement", "richText"],
  sidebar: ["articleList", "categories", "tags", "articleTags", "share", "richText"],
};

export const BLOCK_LIBRARY: Record<BlockType, { name: string; help: string }> = {
  hero: { name: "Featured article (hero)", help: "One large article at the top: the featured one, or the newest." },
  articleList: { name: "Article list", help: "Latest, trending, popular, featured, by topic or tag, or articles you pick." },
  categories: { name: "Topic navigation", help: "The site's topics, with the number of published articles in each." },
  tags: { name: "Tag collection", help: "Tags used by published articles." },
  articleTags: { name: "This article's tags", help: "Shown only on article pages." },
  share: { name: "Share buttons", help: "Shown only on article pages." },
  richText: { name: "Text block", help: "A heading and paragraphs of your own words." },
  announcement: { name: "Announcement", help: "A short promotional line with an optional link." },
};

export const layoutDocSchema = z.object({
  version: z.literal(2),
  homepage: z.object({ blocks: z.array(blockSchema).max(40) }),
  sidebar: z
    .object({
      enabled: z.boolean(),
      blocks: z.array(blockSchema).max(20),
    })
    .default({ enabled: true, blocks: [] }),
});

export type LayoutDoc = z.infer<typeof layoutDocSchema>;

/** Block types that need the article being read. */
export function needsArticle(type: BlockType): boolean {
  return type === "articleTags" || type === "share" || type === "articleList";
}

function randomId(type: BlockType): string {
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${type}-${suffix}`;
}

/** A new, valid, area-appropriate block with safe defaults. */
export function newBlock(type: BlockType, area: Area): Block {
  const base: Record<string, unknown> = { id: randomId(type), type, enabled: true, spacing: "normal", viewAll: null, heading: "", description: "" };
  if (type === "hero") {
    Object.assign(base, { kicker: "", showExcerpt: true, showCover: true });
  } else if (type === "articleList") {
    Object.assign(base, {
      source: area === "sidebar" ? "latest" : "latest",
      count: area === "sidebar" ? 5 : 6,
      style: area === "sidebar" ? "list" : "index",
      columns: area === "sidebar" ? 1 : 3,
      showImages: false,
      showExcerpt: area === "sidebar" ? false : true,
      showMeta: area === "sidebar" ? false : true,
      categoryIds: [],
      tagIds: [],
      slugs: [],
      days: 7,
      empty: "hide",
    });
  } else if (type === "categories") {
    Object.assign(base, { count: area === "sidebar" ? 8 : 12, showCounts: true, style: area === "sidebar" ? "list" : "cards" });
  } else if (type === "tags") {
    Object.assign(base, { count: area === "sidebar" ? 10 : 12 });
  } else if (type === "richText") {
    Object.assign(base, { body: "" });
  } else if (type === "announcement") {
    Object.assign(base, { tone: "accent", linkLabel: "", href: "" });
  }
  const parsed = blockSchema.safeParse(base);
  if (!parsed.success) throw new Error(`Could not create a ${type} block.`);
  return parsed.data;
}

export function moveBlock<T extends { id: string }>(blocks: T[], id: string, direction: -1 | 1): T[] {
  const index = blocks.findIndex((block) => block.id === id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= blocks.length) return blocks;
  const next = [...blocks];
  const [item] = next.splice(index, 1);
  if (!item) return blocks;
  next.splice(target, 0, item);
  return next;
}

export function duplicateBlock(blocks: Block[], id: string): Block[] {
  const index = blocks.findIndex((block) => block.id === id);
  if (index === -1) return blocks;
  const source = blocks[index] as Block;
  const copy = { ...source, id: randomId(source.type) } as Block;
  const next = [...blocks];
  next.splice(index + 1, 0, copy);
  return next;
}

/** Default homepage: exactly what the site shipped before the builder existed. */
export function defaultHomepageBlocks(): Block[] {
  return [
    { ...newBlock("hero", "homepage"), id: "hero-lead", heading: "", kicker: "" } as Block,
    { ...newBlock("articleList", "homepage"), id: "latest-articles", heading: "Latest", source: "latest", count: 8, style: "index" } as Block,
    { ...newBlock("categories", "homepage"), id: "topics-grid", heading: "Topics", count: 12 } as Block,
  ];
}

export function defaultSidebarBlocks(): Block[] {
  return [
    { ...newBlock("articleTags", "sidebar"), id: "sidebar-tags", heading: "Tags" } as Block,
    { ...newBlock("articleList", "sidebar"), id: "sidebar-newest", heading: "New stories", source: "latest", count: 4 } as Block,
    { ...newBlock("share", "sidebar"), id: "sidebar-share", heading: "Share" } as Block,
  ];
}

export function defaultLayout(): LayoutDoc {
  return layoutDocSchema.parse({
    version: 2,
    homepage: { blocks: defaultHomepageBlocks() },
    sidebar: { enabled: true, blocks: defaultSidebarBlocks() },
  });
}

/** Validates anything read from storage; returns null when it cannot be trusted. */
export function parseLayout(input: unknown): LayoutDoc | null {
  if (!input || typeof input !== "object") return null;
  const parsed = layoutDocSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function summariseBlock(block: Block): string {
  switch (block.type) {
    case "hero":
      return "Featured article";
    case "articleList": {
      const source = ARTICLE_SOURCE_LABELS[block.source];
      const where =
        block.source === "category" && block.categoryIds.length > 0
          ? ` (${block.categoryIds.length} topic${block.categoryIds.length === 1 ? "" : "s"})`
          : block.source === "tag" && block.tagIds.length > 0
            ? ` (${block.tagIds.length} tag${block.tagIds.length === 1 ? "" : "s"})`
            : block.source === "manual"
              ? ` (${block.slugs.length} picked)`
              : "";
      return `${source}${where} · ${block.count} article${block.count === 1 ? "" : "s"}`;
    }
    case "categories":
      return `Topic navigation · up to ${block.count}`;
    case "tags":
      return `Tag collection · up to ${block.count}`;
    case "articleTags":
      return "This article's tags";
    case "share":
      return "Share buttons";
    case "richText":
      return "Text block";
    case "announcement":
      return "Announcement";
    default:
      return "Block";
  }
}
