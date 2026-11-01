export const publicationStatuses = ["draft", "published", "unpublished"] as const;

export type PublicationStatus = (typeof publicationStatuses)[number];

export type CoverMotif = "corner" | "band" | "split" | "stamp" | "stack" | "edge";

export type ArticleBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 2 | 3 | 4; text: string }
  /** t106: `children[i]` holds the nested sub-items of `items[i]` (one level). */
  | { type: "list"; ordered?: boolean; items: string[]; children?: string[][] }
  | { type: "quote"; text: string; attribution?: string }
  | { type: "code"; language?: string; code: string }
  /** t91 Phase 2: comparison/data table (markdown pipe table in automation bodies). */
  | { type: "table"; headers: string[]; rows: string[][]; align?: ("left" | "center" | "right" | "")[] }
  /** t106: key-specs card (two columns: label, value). */
  | { type: "specs"; title?: string; rows: string[][] }
  /** t106: callout box (Note / Key takeaway / Tip / Warning). */
  | { type: "callout"; tone: "note" | "takeaway" | "tip" | "warning"; title?: string; text: string }
  /** t106: horizontal rule. */
  | { type: "divider" }
  /** t91 Phase 2: "At a glance" key-takeaways box (2-4 bullets). */
  | { type: "takeaways"; items: string[] };

/** Canonical article. Public pages, a future editor, and automation all use this shape. */
export type Article = {
  /** t115: optional public corrections note, shown at the end of the article. */
  corrections?: string | null;
  /** t141: byline author (set from the creating automation profile). Null = publisher. */
  authorName?: string | null;
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  status: PublicationStatus;
  publishedAt: string | null;
  /** t68: draft is scheduled to publish at this time (request-time sweep). */
  scheduledAt?: string | null;
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
  /** t147: served-image facts for the cover (version token + real hero size; 0 = unknown). */
  coverImage?: CoverImage | null;
  /** Admin grant: AI (via MCP) may edit this specific published article. Migration 0006; absent = false. */
  aiEditAllowed?: boolean;
  blocks: ArticleBlock[];
};

/** t147: `v` versions /media URLs (immutable caching); w/h are the hero's real pixels (0 = unknown). */
export type CoverImage = { v: string; w: number; h: number; /** dominant colour (#rrggbb) of an opaque image, painted while it loads */ c?: string | null };

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

/** Fixed pages, or a topic shortcut ("/topics/<slug>", t96). */
export type NavHref = "/" | "/articles" | "/topics" | "/about" | `/topics/${string}`;

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
  menuTopics: string;
  menuAllTopics: string;
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
  /** t96 homepage sections */
  topicRows: string;
  quickReads: string;
  moreStories: string;
  moreIn: string;
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
  // t96: richer homepage sections
  "river",
  "topicRows",
  "quickReads",
  "moreStories",
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

/** Text on orange (accent) surfaces: day theme colour, then night theme colour. */
export type AccentText = "black" | "white" | "black-white" | "white-black";

export type Appearance = {
  /** 75-100: how dark the night theme page is (100 = pure black). */
  darkness: number;
  /** 85-100: how white the day theme page is (100 = pure white). */
  whiteness: number;
  /** #rrggbb accent color. */
  accent: string;
  /** What an article without a cover image shows. */
  coverFallback: CoverFallback;
  /** Text/icon colour on orange surfaces per theme (t145). Default "black". */
  accentText: AccentText;
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
    columns?: import("../lib/social-links.ts").FooterColumn[];
  };
  about: {
    paragraphs: string[];
  };
  logoMediaId: string | null;
  faviconMediaId: string | null;
  defaultOgMediaId: string | null;
  /** Footer social links (t65); only entries with a URL + visible render. */
  socials: import("../lib/social-links.ts").SocialLink[];
  /** t64: whole-website daily cap on AI/MCP publishes (auto + explicit, all profiles). 0 = no limit. Admin manual publishing is never counted. */
  aiDailyPublishLimit: number;
  /** t148: article share buttons (order, labels, on/off, custom). */
  share: import("../lib/share-buttons.ts").ShareSettings;
  analytics: { enabled: boolean; measurementId: string; consentText: string };
  /**
   * t164: owner tags (verification meta, scripts, links, styles) placed in
   * <head> on every public page by the server, after the consent tool's
   * block. Only meta/link/script/style/noscript are kept (see checkHeadCode).
   */
  customHead: string;
};
