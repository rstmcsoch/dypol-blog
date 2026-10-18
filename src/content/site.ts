import type { BlockType, ContentBlock, NavItem, SiteConfig } from "./types";

/** A block with every field filled. */
export function block(id: string, type: BlockType, over: Partial<ContentBlock> = {}): ContentBlock {
  return { id, type, enabled: true, title: "", count: 5, layout: "list", categoryId: "", tagId: "", body: "", ctaLabel: "", ctaHref: "", ...over };
}

/**
 * Public site configuration.
 * Routine labels, navigation, trending, and footer copy live here
 * so the owner can edit them in the admin panel.
 */
export const site = {
  name: "DYPOL Blog",
  title: "DYPOL Blog",
  description:
    "Tech news, reviews and explainers from DYPOL Labs — AI, smartphones, cybersecurity, startups, gadgets and the business of technology.",
  publisher: "DYPOL Labs",
  labels: {
    featured: "Featured",
    also: "Also filed",
    latest: "Latest",
    topics: "Topics",
    read: "Read",
    fullIndex: "Full index",
    indexKicker: "DYPOL Blog",
    indexTitle: "Index",
    indexLede: "Every published piece, newest first.",
    topicsKicker: "Filed under",
    topicsTitle: "Topics",
    topicsLede: "Browse every subject we cover — from AI and smartphones to startups, cybersecurity and electric vehicles.",
    aboutKicker: "DYPOL Blog",
    aboutTitle: "About",
    related: "Continue",
    neighbors: "Along the index",
    newer: "Newer",
    older: "Older",
    minRead: "min",
    emptyTitle: "Nothing filed here yet",
    emptyBody: "No stories here yet. New pieces are published regularly — browse the latest in the meantime.",
    emptyAction: "Browse the index",
    notFoundKicker: "404",
    notFoundTitle: "This page is not in the index.",
    notFoundBody: "We could not find that page. It may have moved, or the address may be wrong.",
    backHome: "Back to the homepage",
    menu: "Menu",
    close: "Close",
    day: "Day",
    night: "Night",
    themeGroup: "Color theme",
    dayTheme: "Day theme, white page",
    nightTheme: "Night theme, black page",
    skip: "Skip to content",
    primaryNav: "Primary",
    footerNav: "Footer",
    errorTitle: "Something went wrong",
    errorHome: "Return home",
    loading: "Loading",
    alsoLike: "You may also like",
    newStories: "New stories",
    share: "Share",
    copyLink: "Copy link",
    linkCopied: "Link copied",
    tags: "Tags",
    popular: "Most read",
  },
  nav: [
    { id: "home", label: "Home", href: "/", visible: true },
    { id: "index", label: "Index", href: "/articles", visible: true },
    { id: "topics", label: "Topics", href: "/topics", visible: true },
    { id: "about", label: "About", href: "/about", visible: true },
  ] satisfies NavItem[],
  trending: {
    enabled: true,
    label: "Now",
    slugs: ["hard-edge-returns", "what-a-machine-should-send", "an-index-not-a-feed"],
    source: "latest",
    mode: "rotate",
    interval: 5,
    count: 5,
    customItems: [],
    animate: false,
    speed: 40,
  },
  home: {
    blocks: [
      block("home-featured", "featured", { count: 1 }),
      block("home-also", "also", { count: 3 }),
      block("home-latest", "latest", { count: 6, layout: "cards", title: "Our new articles" }),
      block("home-related", "related", { count: 3, layout: "cards", title: "You may also like" }),
      block("home-topics", "topics", { count: 12, title: "Browse by topics" }),
      block("home-tags", "tags", { count: 12, title: "Tags" }),
    ],
  },
  articleSidebar: {
    enabled: true,
    blocks: [block("side-tags", "tags"), block("side-new", "newStories", { count: 4 }), block("side-share", "share")],
  },
  appearance: { darkness: 92, whiteness: 100, accent: "#ff4d00", coverFallback: "minimal" },
  footer: {
    note: "DYPOL Blog · DYPOL Labs",
    links: [],
  },
  about: {
    // Kept for settings compatibility — the public About page is managed
    // in Admin → Pages (see src/content/pages-seed.ts).
    paragraphs: [
      "DYPOL Blog is a technology news and reviews publication, published by DYPOL Labs.",
      "We cover artificial intelligence, smartphones, apps, cybersecurity, startups, gadgets and the business of technology — explained in plain language, without the hype.",
    ],
  },
  logoMediaId: null,
  faviconMediaId: null,
} satisfies SiteConfig;
