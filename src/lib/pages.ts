import { z } from "zod";

/**
 * Pages system rules (t52): the standard reader-facing pages live in a
 * `pages` table the owner manages in Admin → Pages. AI/MCP has no page
 * tools on purpose — pages are legal/editorial commitments, human-only.
 */

export const PAGE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Slugs the site itself owns; a page may not shadow these routes. */
export const RESERVED_PAGE_SLUGS = new Set([
  "articles", "topics", "admin", "login", "preview", "media", "oauth",
  "sitemap.xml", "news-sitemap.xml", "feed.xml", "robots.txt", "manifest.webmanifest",
]);

export const pageWriteSchema = z.object({
  id: z.string().max(80).optional(),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(PAGE_SLUG_RE, "Use lowercase letters, numbers and single hyphens."),
  title: z.string().min(1).max(160),
  body: z.string().min(1).max(60_000),
  status: z.enum(["published", "hidden"]),
});
export type PageWrite = z.infer<typeof pageWriteSchema>;

export function checkPageSlug(slug: string): string | null {
  if (!PAGE_SLUG_RE.test(slug)) return "Slug must be lowercase letters, numbers and single hyphens.";
  if (RESERVED_PAGE_SLUGS.has(slug)) return `"${slug}" is used by the site itself — pick another slug.`;
  return null;
}

export function slugifyPageTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export type PublicPage = {
  slug: string;
  title: string;
  description: string;
  body: string;
  updatedAt: string;
};

/** Meta description for a page without an explicit one: first prose lines. */
export function pageExcerpt(body: string, fallback: string): string {
  const text = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("|") && !l.startsWith("-") && !/^\d+\./.test(l))
    .join(" ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return fallback;
  return text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text;
}
