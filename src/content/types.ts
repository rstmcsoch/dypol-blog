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
  /** All topics the article is filed under (migration 0007). categoryId is always topicIds[0], the primary topic. */
  topicIds: string[];
  tagIds: string[];
  motif: CoverMotif;
  featured: boolean;
  seoTitle?: string;
  seoDescription?: string;
  /** Set when a stored image should stand in for the geometric plate. */
  coverMediaId?: string | null;
  /** Descriptive alt text stored with the cover image in the media library. */
  coverAlt?: string | null;
  /** Admin grant: AI (via MCP) may edit this specific published article. Migration 0006; absent = false. */
  aiEditAllowed?: boolean;
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
  alsoLike: string;
  newStories: string;
  share: string;
  copyLink: string;
  linkCopied: string;
  tags: string;
  popular: string;
};

export const BLOCK_TYPES = [
  "featured",
  "also",
  "latest",
  "related",
  "popular",
  "category",
  "tag",
  "topics",
  "ticker",
  "text",
  "cta",
  "tags",
  "newStories",
  "share",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
export type BlockLayout = "list" | "grid" | "cards";

/**
 * One configurable block, used by the homepage builder and the article sidebar.
 * Empty `title` means "use the default heading from Site text".
 */
export type ContentBlock = {
  id: string;
  type: BlockType;
  enabled: boolean;
  title: string;
  count: number;
  layout: BlockLayout;
  /** category / tag blocks */
  categoryId: string;
  tagId: string;
  /** text block (safe markdown) and cta block */
  body: string;
  ctaLabel: string;
  ctaHref: string;
};

export type TickerItem = { id: string; text: string; href: string };

export type CoverFallback = "plate" | "minimal" | "none";

export type Appearance = {
  /** 75-100: how dark the night theme page is (100 = pure black). */
  darkness: number;
  /** 85-100: how white the day theme page is (100 = pure white). */
  whiteness: number;
  /** #rrggbb accent color. */
  accent: string;
  /** What an article without a cover image shows. */
  coverFallback: CoverFallback;
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
    /** Pinned article slugs (source "pinned"). */
    slugs: string[];
    source: "latest" | "pinned" | "custom" | "popular";
    /** static row, continuous scroll, or one item at a time */
    mode: "static" | "scroll" | "rotate";
    /** Seconds each item stays when rotating. */
    interval: number;
    count: number;
    customItems: TickerItem[];
    /** Legacy flag (PR #5); `mode` wins. */
    animate: boolean;
    /** Seconds per full loop when animated. */
    speed: number;
  };
  home: { blocks: ContentBlock[] };
  articleSidebar: { enabled: boolean; blocks: ContentBlock[] };
  appearance: Appearance;
  footer: {
    note: string;
    links: FooterLink[];
  };
  about: {
    paragraphs: string[];
  };
  logoMediaId: string | null;
  faviconMediaId: string | null;
  /** Footer social links (t65); only entries with a URL + visible render. */
  socials: import("../lib/social-links.ts").SocialLink[];
  /** t64: whole-website daily cap on AI/MCP publishes (auto + explicit, all profiles). 0 = no limit. Admin manual publishing is never counted. */
  aiDailyPublishLimit: number;
};
