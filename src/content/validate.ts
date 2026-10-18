import { z } from "zod";
import { isSafeHref } from "./rules.ts";
import { site } from "./site.ts";
import { BLOCK_TYPES, publicationStatuses, type ContentBlock, type SiteConfig } from "./types.ts";

export { isSafeHref, publishProblems, slugify } from "./rules.ts";

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens.");

const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text: z.string().max(20000) }),
  z.object({
    type: z.literal("heading"),
    level: z.union([z.literal(2), z.literal(3)]),
    text: z.string().max(300),
  }),
  z.object({
    type: z.literal("list"),
    ordered: z.boolean().optional(),
    items: z.array(z.string().max(2000)).max(40),
  }),
  z.object({
    type: z.literal("quote"),
    text: z.string().max(5000),
    attribution: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal("code"),
    language: z.string().max(40).optional(),
    code: z.string().max(20000),
  }),
]);

export const articleWriteSchema = z.object({
  id: z.string().min(1).max(80).nullable(),
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(80),
  excerpt: z.string().trim().max(500),
  categoryId: z.string().min(1).max(80),
  tagIds: z.array(z.string().min(1).max(80)).max(24),
  motif: z.enum(["corner", "band", "split", "stamp", "stack", "edge"]),
  featured: z.boolean(),
  seoTitle: z.string().trim().max(200),
  seoDescription: z.string().trim().max(300),
  coverMediaId: z.string().min(1).max(80).nullable(),
  publishedAt: z.string().datetime().nullable(),
  blocks: z.array(blockSchema).max(80),
  intent: z.enum(["save", "publish", "unpublish"]),
});

export type ArticleWrite = z.infer<typeof articleWriteSchema>;

const hrefSchema = z
  .string()
  .trim()
  .max(300)
  .refine((value) => isSafeHref(value), "Link must be a site path or an https URL.");

export const HOME_BLOCK_TYPES = ["featured", "also", "latest", "related", "popular", "category", "tag", "topics", "ticker", "text", "cta"] as const;
export const SIDEBAR_BLOCK_TYPES = ["tags", "related", "newStories", "popular", "share", "category", "tag", "text", "cta"] as const;

const labelText = z.string().trim().min(1).max(80);

const blockSchema2 = z.object({
  id: z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9_-]+$/),
  type: z.enum(BLOCK_TYPES),
  enabled: z.boolean(),
  title: z.string().trim().max(120),
  count: z.number().int().min(1).max(50),
  layout: z.enum(["list", "grid", "cards"]),
  categoryId: z.string().max(80),
  tagId: z.string().max(80),
  body: z.string().max(5000),
  ctaLabel: z.string().trim().max(80),
  ctaHref: z.union([z.literal(""), z.string().trim().max(500).refine((v) => isSafeHref(v), "Use /path or https://…")]),
});

function blockList(types: readonly string[], max: number) {
  return z
    .array(blockSchema2)
    .max(max)
    .superRefine((list, ctx) => {
      const ids = new Set<string>();
      list.forEach((b, i) => {
        if (!types.includes(b.type)) ctx.addIssue({ code: "custom", path: [i, "type"], message: `“${b.type}” can't be used here.` });
        if (ids.has(b.id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: "Duplicate block id." });
        ids.add(b.id);
        if (b.type === "category" && !b.categoryId) ctx.addIssue({ code: "custom", path: [i, "categoryId"], message: "Pick a topic for this block." });
        if (b.type === "tag" && !b.tagId) ctx.addIssue({ code: "custom", path: [i, "tagId"], message: "Pick a tag for this block." });
        if (b.type === "cta" && (!b.ctaLabel || !b.ctaHref)) ctx.addIssue({ code: "custom", path: [i, "ctaHref"], message: "A button needs a label and a link." });
      });
    });
}

const siteSchema = z.object({
  name: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(300),
  publisher: z.string().trim().min(1).max(80),
  labels: z.object({
    featured: labelText,
    also: labelText,
    latest: labelText,
    topics: labelText,
    read: labelText,
    fullIndex: labelText,
    indexKicker: labelText,
    indexTitle: labelText,
    indexLede: z.string().trim().min(1).max(240),
    topicsKicker: labelText,
    topicsTitle: labelText,
    topicsLede: z.string().trim().min(1).max(240),
    aboutKicker: labelText,
    aboutTitle: labelText,
    related: labelText,
    neighbors: labelText,
    newer: labelText,
    older: labelText,
    minRead: labelText,
    emptyTitle: z.string().trim().min(1).max(120),
    emptyBody: z.string().trim().min(1).max(240),
    emptyAction: labelText,
    notFoundKicker: labelText,
    notFoundTitle: z.string().trim().min(1).max(160),
    notFoundBody: z.string().trim().min(1).max(240),
    backHome: labelText,
    menu: labelText,
    close: labelText,
    day: labelText,
    night: labelText,
    themeGroup: labelText,
    dayTheme: z.string().trim().min(1).max(120),
    nightTheme: z.string().trim().min(1).max(120),
    skip: labelText,
    primaryNav: labelText,
    footerNav: labelText,
    errorTitle: z.string().trim().min(1).max(120),
    errorHome: labelText,
    loading: labelText,
    alsoLike: labelText,
    newStories: labelText,
    share: labelText,
    copyLink: labelText,
    linkCopied: labelText,
    tags: labelText,
    popular: labelText,
  }),
  nav: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        label: labelText,
        href: z.enum(["/", "/articles", "/topics", "/about"]),
        visible: z.boolean(),
      }),
    )
    .max(8),
  trending: z.object({
    enabled: z.boolean(),
    label: labelText,
    slugs: z.array(slugSchema).max(12),
    source: z.enum(["latest", "pinned", "custom", "popular"]),
    mode: z.enum(["static", "scroll", "rotate"]),
    interval: z.number().int().min(2).max(30),
    count: z.number().int().min(1).max(12),
    customItems: z
      .array(z.object({ id: z.string().min(1).max(40), text: z.string().trim().min(1).max(160), href: z.union([z.literal(""), hrefSchema]) }))
      .max(12),
    animate: z.boolean(),
    speed: z.number().int().min(10).max(180),
  }),
  home: z.object({ blocks: blockList(HOME_BLOCK_TYPES, 30) }),
  articleSidebar: z.object({ enabled: z.boolean(), blocks: blockList(SIDEBAR_BLOCK_TYPES, 12) }),
  appearance: z.object({
    darkness: z.number().int().min(75).max(100),
    whiteness: z.number().int().min(85).max(100),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb color.").transform((v) => v.toLowerCase()),
    coverFallback: z.enum(["plate", "minimal", "none"]),
  }),
  footer: z.object({
    note: z.string().trim().min(1).max(160),
    links: z
      .array(
        z.object({
          id: z.string().min(1).max(40),
          label: labelText,
          href: hrefSchema,
        }),
      )
      .max(8),
  }),
  about: z.object({
    paragraphs: z.array(z.string().trim().min(1).max(2000)).min(1).max(12),
  }),
  logoMediaId: z.string().min(1).max(80).nullable(),
  faviconMediaId: z.string().min(1).max(80).nullable(),
});


const fill = (b: Partial<ContentBlock> & { id: string; type: ContentBlock["type"] }): ContentBlock => ({
  enabled: true, title: "", count: 5, layout: "list", categoryId: "", tagId: "", body: "", ctaLabel: "", ctaHref: "", ...b,
});

/** Converts the PR #5 shapes (fixed sections / string sidebar blocks) to block lists. */
export function upgradeHome(raw: unknown): unknown {
  const r = (raw ?? {}) as { blocks?: unknown; sections?: { id: string; enabled?: boolean; count?: number }[] };
  if (Array.isArray(r.blocks)) return { blocks: r.blocks.map((b) => fill(b as ContentBlock)) };
  if (Array.isArray(r.sections)) {
    const seen = new Set<string>();
    const known = r.sections.filter((sec) => (HOME_BLOCK_TYPES as readonly string[]).includes(sec?.id) && !seen.has(sec.id) && seen.add(sec.id));
    return { blocks: known.map((sec) => fill({ id: `home-${sec.id}`, type: sec.id as ContentBlock["type"], enabled: sec.enabled ?? true, count: sec.count ?? 5 })) };
  }
  return site.home;
}

export function upgradeSidebar(raw: unknown): unknown {
  const r = (raw ?? {}) as { enabled?: boolean; blocks?: unknown[]; count?: number };
  if (!Array.isArray(r.blocks)) return { ...site.articleSidebar, ...(typeof r.enabled === "boolean" ? { enabled: r.enabled } : {}) };
  return {
    enabled: r.enabled ?? true,
    blocks: r.blocks.map((b) =>
      typeof b === "string" ? fill({ id: `side-${b}`, type: b as ContentBlock["type"], count: r.count ?? 4 }) : fill(b as ContentBlock),
    ),
  };
}

function upgradeTrending(raw: unknown): unknown {
  const r = { ...site.trending, ...((raw ?? {}) as object) } as SiteConfig["trending"] & { mode?: string };
  // Before PR #5 the strip only showed picked articles.
  if (raw && !(raw as { source?: string }).source && Array.isArray((raw as { slugs?: unknown }).slugs)) r.source = "pinned";
  if (!raw || !(raw as { mode?: string }).mode) r.mode = (raw as { animate?: boolean })?.animate ? "scroll" : site.trending.mode;
  return r;
}

/**
 * Stored settings merged over defaults. Each newer group falls back to its
 * default on its own if invalid, so one bad value never blanks the site.
 */
export function normalizeSite(input: unknown): SiteConfig {
  const raw = input && typeof input === "object" ? (input as Partial<SiteConfig>) : {};
  const shape = siteSchema.shape;
  const pick = <K extends "trending" | "home" | "articleSidebar" | "appearance">(key: K, value: unknown): SiteConfig[K] => {
    const parsed = shape[key].safeParse(value);
    return (parsed.success ? parsed.data : site[key]) as SiteConfig[K];
  };
  return normalizeCore({
    ...raw,
    trending: pick("trending", upgradeTrending(raw.trending)),
    home: pick("home", upgradeHome(raw.home)),
    articleSidebar: pick("articleSidebar", upgradeSidebar(raw.articleSidebar)),
    appearance: pick("appearance", { ...site.appearance, ...(raw.appearance ?? {}) }),
  });
}

function normalizeCore(input: unknown): SiteConfig {
  const raw = input && typeof input === "object" ? (input as Partial<SiteConfig>) : {};
  return siteSchema.parse({
    ...site,
    ...raw,
    labels: { ...site.labels, ...(raw.labels ?? {}) },
    nav: Array.isArray(raw.nav) && raw.nav.length > 0 ? raw.nav : site.nav,
    trending: { ...site.trending, ...(raw.trending ?? {}) },
    footer: { ...site.footer, ...(raw.footer ?? {}), links: raw.footer?.links ?? site.footer.links },
    about: {
      paragraphs:
        Array.isArray(raw.about?.paragraphs) && raw.about.paragraphs.length > 0
          ? raw.about.paragraphs
          : site.about.paragraphs,
    },
    logoMediaId: raw.logoMediaId ?? null,
    faviconMediaId: raw.faviconMediaId ?? null,
  });
}

export function parseSite(input: unknown): SiteConfig {
  return siteSchema.parse(input);
}

export const categoryWriteSchema = z.object({
  id: z.string().min(1).max(80).nullable(),
  label: z.string().trim().min(1).max(80),
  slug: z.string().trim().max(80),
  description: z.string().trim().max(400),
});

export const tagWriteSchema = z.object({
  id: z.string().min(1).max(80).nullable(),
  label: z.string().trim().min(1).max(80),
  slug: z.string().trim().max(80),
});

export const mediaWriteSchema = z.object({
  filename: z.string().trim().min(1).max(120),
  mime: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  alt: z.string().trim().max(200),
  dataBase64: z.string().min(1).max(2_800_000),
});

export const articleListSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(publicationStatuses).optional(),
  categoryId: z.string().max(80).optional(),
  tagId: z.string().max(80).optional(),
  sort: z.enum(["updated", "published", "title"]).optional(),
});

export function decodeImage(dataBase64: string, mime: string): Buffer {
  const cleaned = dataBase64.replace(/^data:[^,]*,/, "");
  const bytes = Buffer.from(cleaned, "base64");
  if (bytes.length === 0 || bytes.length > 1_500_000) {
    throw new Error("Image must be under 1.5 MB.");
  }
  if (!matchesMime(bytes, mime)) throw new Error("That file is not the image type it claims.");
  return bytes;
}

function matchesMime(bytes: Buffer, mime: string): boolean {
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (mime === "image/png") return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mime === "image/gif") return bytes.subarray(0, 3).toString("ascii") === "GIF";
  if (mime === "image/webp") {
    return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}
