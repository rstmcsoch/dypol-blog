import type { NavItem } from "./types";

/**
 * Public site configuration.
 * Routine labels, navigation, trending, and footer copy live here
 * so a later admin can own them without a redesign.
 */
export const site = {
  name: "DYPOL Blog",
  title: "DYPOL Blog",
  description:
    "The public journal of DYPOL Labs. Black and white carry the page. Color shows up only where it should be noticed.",
  publisher: "DYPOL Labs",
  labels: {
    featured: "Featured",
    also: "Also filed",
    latest: "Latest",
    topics: "Topics",
    read: "Read",
    fullIndex: "Full index",
    indexKicker: "Journal",
    indexTitle: "Index",
    indexLede: "Every published piece, newest first.",
    topicsKicker: "Filed under",
    topicsTitle: "Topics",
    topicsLede: "Pieces are filed by subject. A topic with nothing published stays on the list.",
    aboutKicker: "The journal",
    aboutTitle: "About",
    related: "Continue",
    neighbors: "Along the index",
    newer: "Newer",
    older: "Older",
    minRead: "min",
    emptyTitle: "Nothing filed here yet",
    emptyBody: "When a piece in this topic is published, it will show up in this list.",
    emptyAction: "Browse the index",
    notFoundKicker: "404",
    notFoundTitle: "This page is not in the index.",
    notFoundBody: "The address does not match a published page.",
    backHome: "Back to the journal",
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
  },
  nav: [
    { id: "home", label: "Home", href: "/" },
    { id: "index", label: "Index", href: "/articles" },
    { id: "topics", label: "Topics", href: "/topics" },
    { id: "about", label: "About", href: "/about" },
  ] satisfies NavItem[],
  trending: {
    enabled: true,
    label: "Now",
    slugs: ["hard-edge-returns", "what-a-machine-should-send", "an-index-not-a-feed"],
  },
  footer: {
    note: "DYPOL Blog · DYPOL Labs",
  },
  about: {
    paragraphs: [
      "DYPOL Blog is the public journal of DYPOL Labs.",
      "The page is built as a publication: a white day, a black night, hard edges, and a single color used sparingly. Grain sits only on that color. It is there to give the accent a printed feel, not to cover the type.",
      "The essays on the index are sample pieces. They show how a story is titled, filed, and read. They are not statements about the lab, and they are not a record of people, partners, or results.",
      "The same article shape is what a later editor and an automated publishing flow will both write. Neither one needs its own format.",
    ],
  },
} as const;
