import { z } from "zod";
import { isSafeHref } from "./rules";
import { site } from "./site";
import { publicationStatuses, type SiteConfig } from "./types";

export { isSafeHref, publishProblems, slugify } from "./rules";

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

const labelText = z.string().trim().min(1).max(80);

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

export function normalizeSite(input: unknown): SiteConfig {
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
