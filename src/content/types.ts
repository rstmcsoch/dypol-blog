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
  /** Set when a stored image should stand in for the geometric plate. */
  coverMediaId?: string | null;
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
  visible: boolean;
};

export type FooterLink = {
  id: string;
  label: string;
  href: string;
};

export type SiteLabels = {
  featured: string;
  also: string;
  latest: string;
  topics: string;
  read: string;
  fullIndex: string;
  indexKicker: string;
  indexTitle: string;
  indexLede: string;
  topicsKicker: string;
  topicsTitle: string;
  topicsLede: string;
  aboutKicker: string;
  aboutTitle: string;
  related: string;
  neighbors: string;
  newer: string;
  older: string;
  minRead: string;
  emptyTitle: string;
  emptyBody: string;
  emptyAction: string;
  notFoundKicker: string;
  notFoundTitle: string;
  notFoundBody: string;
  backHome: string;
  menu: string;
  close: string;
  day: string;
  night: string;
  themeGroup: string;
  dayTheme: string;
  nightTheme: string;
  skip: string;
  primaryNav: string;
  footerNav: string;
  errorTitle: string;
  errorHome: string;
  loading: string;
};

/** Canonical public configuration. The journal and the desk both read this. */
export type SiteConfig = {
  name: string;
  title: string;
  description: string;
  publisher: string;
  labels: SiteLabels;
  nav: NavItem[];
  trending: {
    enabled: boolean;
    label: string;
    slugs: string[];
  };
  footer: {
    note: string;
    links: FooterLink[];
  };
  about: {
    paragraphs: string[];
  };
  logoMediaId: string | null;
  faviconMediaId: string | null;
};
