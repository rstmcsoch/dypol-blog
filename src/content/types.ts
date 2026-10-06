export const publicationStatuses = ["draft", "published", "unpublished"] as const;

export type PublicationStatus = (typeof publicationStatuses)[number];

export type CoverMotif = "corner" | "band" | "split" | "stamp" | "stack" | "edge";

export type ArticleBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "list"; ordered?: boolean; items: string[] }
  | { type: "quote"; text: string; attribution?: string }
  | { type: "code"; language?: string; code: string };

/** Canonical article. Public pages, a future editor, and automation all use this shape. */
export type Article = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  status: PublicationStatus;
  publishedAt: string | null;
  updatedAt: string;
  categoryId: string;
  tagIds: string[];
  motif: CoverMotif;
  featured: boolean;
  seoTitle?: string;
  seoDescription?: string;
  blocks: ArticleBlock[];
};

export type Category = {
  id: string;
  slug: string;
  label: string;
  description: string;
};

export type Tag = {
  id: string;
  slug: string;
  label: string;
};

export type NavHref = "/" | "/articles" | "/topics" | "/about";

export type NavItem = {
  id: string;
  label: string;
  href: NavHref;
};
