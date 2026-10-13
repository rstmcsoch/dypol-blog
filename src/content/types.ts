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
  alsoLike: string;
  newStories: string;
  share: string;
  copyLink: string;
  linkCopied: string;
  tags: string;
};

export type HomeSectionId = "featured" | "also" | "latest" | "topics";
export type HomeSection = { id: HomeSectionId; enabled: boolean; count: number };

export type SidebarBlock = "tags" | "related" | "newStories" | "share";

export type TickerItem = { id: string; text: string; href: string };

/** Where the ticking strip takes its items from. */
export type TickerSource = "trending" | "latest" | "featured" | "category" | "pinned" | "custom";

/** How the strip behaves: one item at a time (rotating), or the first one only. */
export type TickerMode = "rotate" | "still";

export type TrendingConfig = {
  enabled: boolean;
  label: string;
  /** Pinned article slugs, in the owner's order (source "pinned"). */
  slugs: string[];
  source: TickerSource;
  count: number;
  customItems: TickerItem[];
  /** Category ids used when source is "category". */
  categories: string[];
  /** Seconds each article stays on screen (3-60). */
  intervalSeconds: number;
  mode: TickerMode;
  /** Show the coloured label chip. */
  showLabel: boolean;
  /** Show the "3 / 7" position counter. */
  showIndex: boolean;
  pauseOnHover: boolean;
  /** Legacy continuous marquee (kept working, off by default). */
  animate: boolean;
  speed: number;
};

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
  trending: TrendingConfig;
  home: { sections: HomeSection[] };
  articleSidebar: { enabled: boolean; blocks: SidebarBlock[]; count: number };
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
};
