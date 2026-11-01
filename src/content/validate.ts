import { z } from "zod";
import { isSafeHref } from "./rules.ts";
import { site, T96_HOME_BLOCKS } from "./site.ts";
import { BLOCK_TYPES, publicationStatuses, type ContentBlock, type NavItem, type SiteConfig } from "./types.ts";
import { SOCIAL_PLATFORMS, normalizeSocials, validSocialUrl } from "../lib/social-links.ts";
import { SHARE_KINDS, customTemplateError, normalizeShareSettings } from "../lib/share-buttons.ts";

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
    level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    text: z.string().max(300),
  }),
  z.object({
    type: z.literal("list"),
    ordered: z.boolean().optional(),
    items: z.array(z.string().max(2000)).max(40),
    children: z.array(z.array(z.string().max(2000)).max(20)).max(40).optional(),
  }),
  z.object({
    type: z.literal("quote"),
    text: z.string().max(5000),
    attribution: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal("table"),
    headers: z.array(z.string().max(200)).max(8),
    rows: z.array(z.array(z.string().max(2000)).max(8)).max(40),
    align: z.array(z.enum(["left", "center", "right", ""])).max(8).optional(),
  }),
  z.object({
    type: z.literal("specs"),
    title: z.string().max(200).optional(),
    rows: z.array(z.array(z.string().max(1000)).max(2)).max(40),
  }),
  z.object({
    type: z.literal("callout"),
    tone: z.enum(["note", "takeaway", "tip", "warning"]),
    title: z.string().max(200).optional(),
    text: z.string().max(5000),
  }),
  z.object({ type: z.literal("divider") }),
  z.object({ type: z.literal("takeaways"), items: z.array(z.string().max(2000)).max(6) }),
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
  /** All topics (first = primary, stored into categoryId). Absent = just [categoryId]. Max 4, matching the AI guidance. */
  topicIds: z.array(z.string().min(1).max(80)).max(4).optional(),
  tagIds: z.array(z.string().min(1).max(80)).max(24),
  motif: z.enum(["corner", "band", "split", "stamp", "stack", "edge"]),
  featured: z.boolean(),
  seoTitle: z.string().trim().max(200),
  seoDescription: z.string().trim().max(300),
  coverMediaId: z.string().min(1).max(80).nullable(),
  publishedAt: z.string().datetime().nullable(),
  scheduledAt: z.string().datetime().nullable().optional(),
  /** t115: absent = leave the stored note unchanged; "" clears it. */
  corrections: z.string().trim().max(2000).optional(),
  blocks: z.array(blockSchema).max(80),
  intent: z.enum(["save", "publish", "unpublish"]),
});

export type ArticleWrite = z.infer<typeof articleWriteSchema>;

const hrefSchema = z
  .string()
  .trim()
  .max(300)
  .refine((value) => isSafeHref(value), "Link must be a site path or an https URL.");

export const HOME_BLOCK_TYPES = ["featured", "also", "latest", "related", "popular", "category", "tag", "topics", "ticker", "text", "cta", "tags", "river", "topicRows", "quickReads", "moreStories"] as const;
/** t96 homepage section types; a saved homepage without any of them gets them once. */
export const T96_HOME_TYPES = ["river", "topicRows", "quickReads", "moreStories"] as const;
export const SIDEBAR_BLOCK_TYPES = ["tags", "related", "newStories", "popular", "share", "category", "tag", "text", "cta"] as const;

const labelText = z.string().trim().min(1).max(80);

/** t96: a menu shortcut to one topic page. */
export const NAV_TOPIC_HREF = /^\/topics\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
    menuTopics: labelText,
    menuAllTopics: labelText,
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
    topicRows: labelText,
    quickReads: labelText,
    moreStories: labelText,
    moreIn: labelText,
  }),
  nav: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        label: labelText,
        href: z.union([z.enum(["/", "/articles", "/topics", "/about"]), z.string().regex(NAV_TOPIC_HREF, "Topic shortcuts must be /topics/<slug>.") as z.ZodType<`/topics/${string}`>]),
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
    accentText: z.enum(["black", "white", "black-white", "white-black"]).default("black"),
  }),
  footer: z.object({
    columns: z.array(z.object({
      heading: labelText,
      links: z.array(z.object({ label: labelText, href: hrefSchema, newTab: z.boolean().optional() })).max(20),
    })).max(6).optional(),
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
  defaultOgMediaId: z.string().min(1).max(80).nullable().default(null),
  analytics: z.object({
    enabled: z.boolean(),
    measurementId: z.string().trim().regex(/^(?:G-[A-Z0-9]+)?$/, "Use a GA4 ID such as G-ABC123, or leave empty."),
    consentText: z.string().trim().min(1).max(500),
  }).default(site.analytics),
  socials: z
    .array(
      z
        .object({
          platform: z.enum(SOCIAL_PLATFORMS),
          url: z.string().trim().max(500),
          visible: z.boolean(),
        })
        .superRefine((entry, ctx) => {
          if (!validSocialUrl(entry.platform, entry.url)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["url"],
              message: entry.platform === "email" ? "Use a mailto: address." : "Use a full https:// URL.",
            });
          }
        }),
    )
    .max(7),
  aiDailyPublishLimit: z.number().int().min(0).max(100),
  share: z.object({
    buttons: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(40),
            kind: z.enum(SHARE_KINDS),
            enabled: z.boolean(),
            label: z.string().trim().max(40),
            template: z.string().trim().max(500),
          })
          .superRefine((b, ctx) => {
            if (b.kind !== "custom") return;
            const problem = customTemplateError(b.template);
            if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["template"] });
          }),
      )
      .max(24)
      .refine((list) => new Set(list.map((b) => b.id)).size === list.length, "Each share button needs a unique id."),
  }),
});


const fill = (b: Partial<ContentBlock> & { id: string; type: ContentBlock["type"] }): ContentBlock => ({
  enabled: true, title: "", count: 5, layout: "list", categoryId: "", tagId: "", body: "", ctaLabel: "", ctaHref: "", ...b,
});

/** Converts the PR #5 shapes (fixed sections / string sidebar blocks) to block lists. */
/** Rich homepage defaults: if a saved block list lacks an essential section, add it (enabled). Blocks the owner disabled stay disabled — only missing types are backfilled. */
export const ESSENTIAL_HOME_BLOCKS: ContentBlock[] = [
  fill({ id: "home-featured", type: "featured", count: 1 }),
  fill({ id: "home-latest", type: "latest", count: 6, layout: "cards", title: "Our new articles" }),
  fill({ id: "home-related", type: "related", count: 3, layout: "cards", title: "You may also like" }),
  fill({ id: "home-topics", type: "topics", count: 12, title: "Browse by topics" }),
  fill({ id: "home-tags", type: "tags", count: 12, title: "Tags" }),
];

export function upgradeHome(raw: unknown): unknown {
  const r = (raw ?? {}) as { blocks?: unknown; sections?: { id: string; enabled?: boolean; count?: number }[] };
  let blocks: ContentBlock[] | null = null;
  if (Array.isArray(r.blocks)) {
    blocks = r.blocks.map((b) => fill(b as ContentBlock));
  } else if (Array.isArray(r.sections)) {
    // Pre-block-list shape (PR #5): convert, then fall through to the same
    // title-fill + essential-section backfill as the blocks shape. Prod
    // still stores this shape, so skipping the backfill here left the
    // homepage without Latest/Related/Tags sections.
    const seen = new Set<string>();
    const known = r.sections.filter((sec) => (HOME_BLOCK_TYPES as readonly string[]).includes(sec?.id) && !seen.has(sec.id) && seen.add(sec.id));
    blocks = known.map((sec) => fill({ id: `home-${sec.id}`, type: sec.id as ContentBlock["type"], enabled: sec.enabled ?? true, count: sec.count ?? 5 }));
  }
  if (!blocks) return site.home;
  for (const filled of blocks) {
    if (!filled.title && filled.type === "latest") filled.title = "Our new articles";
    if (!filled.title && filled.type === "topics") filled.title = "Browse by topics";
    if (!filled.title && filled.type === "related") filled.title = "You may also like";
  }
  const have = new Set(blocks.map((b) => b.type));
  const missing = ESSENTIAL_HOME_BLOCKS.filter((b) => !have.has(b.type));
  // Featured belongs first; the rest append in default order, respecting the owner's existing order/visibility.
  const featured = missing.filter((b) => b.type === "featured");
  return { blocks: addT96Sections([...featured, ...blocks, ...missing.filter((b) => b.type !== "featured")]) };
}

/**
 * t96: a homepage saved before the sectioned front page existed gets the new
 * sections once — river, topic rows and quick reads right after the coloured
 * band (or the hero), "More stories" before the tags (or at the end). The old
 * "latest" block is switched off (not deleted) because the river replaces it.
 * A list that already has any t96 section is the owner's and is left alone,
 * so deleting one of them later sticks.
 */
export function addT96Sections(blocks: ContentBlock[]): ContentBlock[] {
  if (blocks.some((b) => (T96_HOME_TYPES as readonly string[]).includes(b.type))) return blocks;
  if (blocks.length + T96_HOME_BLOCKS.length + 1 > 30) return blocks; // never push the owner's own blocks out
  const ids = new Set(blocks.map((b) => b.id));
  const uniq = (b: ContentBlock): ContentBlock => {
    let id = b.id;
    for (let n = 2; ids.has(id); n++) id = `${b.id}-${n}`;
    ids.add(id);
    return { ...b, id };
  };
  const firstLatest = blocks.findIndex((b) => b.type === "latest" && b.enabled);
  const next = blocks.map((b, i) => (i === firstLatest ? { ...b, enabled: false } : b));
  let at = next.findIndex((b) => b.type === "also");
  if (at < 0) at = next.findIndex((b) => b.type === "featured");
  next.splice(at + 1, 0, ...T96_HOME_BLOCKS.map(uniq));
  const tagsAt = next.findIndex((b) => b.type === "tags");
  const more = uniq(fill({ id: "home-more", type: "moreStories", count: 9, layout: "grid" }));
  if (tagsAt >= 0) next.splice(tagsAt, 0, more);
  else next.push(more);
  return next;
}

/**
 * t96: the original four-link menu (Home, Index, Topics, About) becomes the
 * new default (Latest, two topic shortcuts, Topics, About; Home stays
 * reachable from the logo). Only an untouched legacy menu is upgraded — the
 * owner's own labels and hidden items carry over, and any menu that already
 * has a topic shortcut (i.e. was saved after t96) is left exactly as saved.
 */
export function upgradeNav(raw: unknown): NavItem[] {
  if (!Array.isArray(raw) || raw.length === 0) return site.nav;
  const items = raw as NavItem[];
  const legacyIds = ["home", "index", "topics", "about"];
  const legacy = items.every((item) => item && legacyIds.includes(item.id) && ["/", "/articles", "/topics", "/about"].includes(item.href));
  if (!legacy) return items;
  const legacyLabels: Record<string, string> = { home: "Home", index: "Index", topics: "Topics", about: "About" };
  return site.nav.map((item) => {
    const old = items.find((x) => x.id === item.id);
    if (!old) return item;
    const customLabel = old.label.trim() && old.label.trim() !== legacyLabels[item.id] ? old.label : item.label;
    // Home moves to the logo by default; an owner-hidden item stays hidden.
    return { ...item, label: customLabel, visible: item.visible && old.visible };
  });
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
    nav: upgradeNav(raw.nav),
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
    analytics: { ...site.analytics, ...(raw.analytics ?? {}) },
    socials: normalizeSocials(raw.socials),
    aiDailyPublishLimit: typeof raw.aiDailyPublishLimit === "number" ? raw.aiDailyPublishLimit : 0,
    share: normalizeShareSettings(raw.share),
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
  dataBase64: z.string().min(1).max(14_000_000),
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
  if (bytes.length === 0 || bytes.length > 10_000_000) {
    throw new Error("Image must be under 10 MB.");
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
