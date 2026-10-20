/**
 * Pure SEO builders (t48): absolute URLs, JSON-LD (NewsArticle,
 * BreadcrumbList, WebSite/Organization, ItemList), RSS, sitemaps.
 * Everything here takes the request origin explicitly so the same code
 * serves production, previews and local dev, and is unit-testable.
 */

export function absoluteUrl(origin: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = origin.replace(/\/+$/, "");
  return base + (path.startsWith("/") ? path : `/${path}`);
}

export function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Clean, snippet-ready meta description: collapse whitespace and cap at
 * 160 chars on a word boundary (Guide: short, unique, relevant points). */
export function metaDescription(text: string | null | undefined, fallback = ""): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim() || fallback.replace(/\s+/g, " ").trim();
  if (clean.length <= 160) return clean;
  const cut = clean.slice(0, 157);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Consistent brand suffix for every non-home page title. */
export function sitePageTitle(pageTitle: string): string {
  const clean = pageTitle.trim().replace(/\\s*(?:\\||—|-)\\s*DYPOL Blog\\s*$/i, "").trim();
  return `${clean || "Page"} | DYPOL Blog`;
}

/** Topic pages seeded with a one-line description get a fuller, still
 * accurate snippet instead of a 44–61 char fragment (live audit t89). */
export function topicMetaDescription(label: string, description: string | null | undefined): string {
  const base = (description ?? "").replace(/\s+/g, " ").trim().replace(/\.$/, "");
  if (base.length >= 90) return metaDescription(base);
  const enriched = base
    ? `${base}. Latest ${label} news, reviews and explainers from DYPOL Blog.`
    : `Latest ${label} news, reviews and explainers from DYPOL Blog.`;
  return metaDescription(enriched);
}

export type SeoArticle = {
  slug: string;
  title: string;
  excerpt: string;
  description: string;
  publishedAt: string | null;
  updatedAt: string;
  topics: string[];
  coverMediaId?: string | null;
  coverAlt?: string | null;
  /** t91 Phase 3: plain-text article body for full-text RSS (optional). */
  bodyText?: string;
};

/** The one public host. Both Worker names (and version-preview URLs) serve
 * the same content on workers.dev, so SEO URLs must consolidate here. */
export const CANONICAL_ORIGIN = "https://dypolblog.rstmcsoch.workers.dev";

export function canonicalOriginFrom(requestUrl: string): string {
  try {
    const url = new URL(requestUrl);
    if (url.hostname.endsWith(".workers.dev")) return CANONICAL_ORIGIN;
    return url.origin;
  } catch {
    return CANONICAL_ORIGIN;
  }
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** NewsArticle JSON-LD for an article page (Google Article rich results + Discover). */
export function articleJsonLd(input: { origin: string; siteName: string; publisher: string; authorName?: string; article: SeoArticle }) {
  const { origin, publisher, authorName, article } = input;
  const url = absoluteUrl(origin, `/articles/${article.slug}`);
  const published = isoOrNull(article.publishedAt);
  const modified = isoOrNull(article.updatedAt) ?? published;
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title.slice(0, 110),
    description: article.description,
    ...(article.coverMediaId ? { image: [absoluteUrl(origin, `/media/${article.coverMediaId}`)] } : {}),
    ...(published ? { datePublished: published } : {}),
    ...(modified ? { dateModified: modified } : {}),
    author: [{ "@type": "Organization", name: authorName ?? publisher, url: absoluteUrl(origin, "/about") }],
    publisher: {
      "@type": "Organization",
      name: publisher,
      url: absoluteUrl(origin, "/"),
      logo: { "@type": "ImageObject", url: absoluteUrl(origin, "/logo.png"), width: 1056, height: 256 },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    isAccessibleForFree: true,
    ...(article.topics.length ? { articleSection: article.topics, keywords: article.topics.join(", ") } : {}),
  };
}

export function breadcrumbJsonLd(input: { origin: string; items: { name: string; path: string }[] }) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: input.items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(input.origin, item.path),
    })),
  };
}

/** WebSite + Organization graph for the homepage. */
export function websiteJsonLd(input: { origin: string; siteName: string; title: string; description: string; publisher: string; sameAs?: string[] }) {
  const home = absoluteUrl(input.origin, "/");
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${home}#website`,
        url: home,
        name: input.siteName || input.title,
        description: input.description,
        publisher: { "@id": `${home}#organization` },
        inLanguage: "en",
      },
      {
        "@type": "Organization",
        "@id": `${home}#organization`,
        name: input.publisher,
        url: home,
        logo: absoluteUrl(input.origin, "/logo.png"),
        ...(input.sameAs?.length ? { sameAs: input.sameAs } : {}),
      },
    ],
  };
}

export function itemListJsonLd(input: { origin: string; items: { name: string; path: string }[] }) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: input.items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      url: absoluteUrl(input.origin, item.path),
    })),
  };
}

export type SitemapUrl = { path: string; lastmod?: string | null; imagePath?: string | null; imageTitle?: string | null };

export function sitemapXml(input: { origin: string; urls: SitemapUrl[] }): string {
  const hasImages = input.urls.some((u) => u.imagePath);
  const rows = input.urls
    .map((u) => {
      const lastmod = isoOrNull(u.lastmod);
      const image = u.imagePath
        ? `<image:image><image:loc>${xmlEscape(absoluteUrl(input.origin, u.imagePath))}</image:loc>${u.imageTitle ? `<image:title>${xmlEscape(u.imageTitle)}</image:title>` : ""}</image:image>`
        : "";
      return `  <url><loc>${xmlEscape(absoluteUrl(input.origin, u.path))}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}${image}</url>`;
    })
    .join("\n");
  const ns = hasImages ? ` xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${ns}>\n${rows}\n</urlset>\n`;
}

/** Google News sitemap: only articles from the last 48 hours belong here. */
export function newsSitemapXml(input: { origin: string; publicationName: string; articles: SeoArticle[]; now?: Date }): string {
  const now = input.now ?? new Date();
  const cutoff = now.getTime() - 48 * 3600 * 1000;
  const rows = input.articles
    .filter((a) => {
      const t = Date.parse(a.publishedAt ?? "");
      return !Number.isNaN(t) && t >= cutoff && t <= now.getTime() + 5 * 60 * 1000;
    })
    .map((a) => {
      const published = isoOrNull(a.publishedAt) ?? now.toISOString();
      return [
        "  <url>",
        `    <loc>${xmlEscape(absoluteUrl(input.origin, `/articles/${a.slug}`))}</loc>`,
        "    <news:news>",
        `      <news:publication><news:name>${xmlEscape(input.publicationName)}</news:name><news:language>en</news:language></news:publication>`,
        `      <news:publication_date>${published}</news:publication_date>`,
        `      <news:title>${xmlEscape(a.title)}</news:title>`,
        "    </news:news>",
        "  </url>",
      ].join("\n");
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${rows}\n</urlset>\n`;
}

/** RSS 2.0 feed of the latest published articles. */
export function rssXml(input: { origin: string; siteTitle: string; description: string; articles: SeoArticle[] }): string {
  const home = absoluteUrl(input.origin, "/");
  const items = input.articles
    .map((a) => {
      const url = absoluteUrl(input.origin, `/articles/${a.slug}`);
      const pubDate = a.publishedAt ? new Date(a.publishedAt).toUTCString() : new Date(a.updatedAt).toUTCString();
      const cats = a.topics.map((t) => `      <category>${xmlEscape(t)}</category>`).join("\n");
      const cover = a.coverMediaId ? `      <media:content url="${xmlEscape(absoluteUrl(input.origin, `/media/${a.coverMediaId}`))}" medium="image" />` : "";
      const full = a.bodyText?.trim() ? `      <content:encoded>${xmlEscape(a.bodyText.trim())}</content:encoded>` : "";
      return [
        "    <item>",
        `      <title>${xmlEscape(a.title)}</title>`,
        `      <link>${xmlEscape(url)}</link>`,
        `      <guid isPermaLink="true">${xmlEscape(url)}</guid>`,
        `      <pubDate>${pubDate}</pubDate>`,
        `      <description>${xmlEscape(a.excerpt)}</description>`,
        ...(cats ? [cats] : []),
        ...(cover ? [cover] : []),
        ...(full ? [full] : []),
        "    </item>",
      ].join("\n");
    })
    .join("\n");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">`,
    "  <channel>",
    `    <title>${xmlEscape(input.siteTitle)}</title>`,
    `    <link>${xmlEscape(home)}</link>`,
    `    <atom:link href="${xmlEscape(absoluteUrl(input.origin, "/feed.xml"))}" rel="self" type="application/rss+xml" />`,
    `    <description>${xmlEscape(input.description)}</description>`,
    "    <language>en</language>",
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

/** Open Graph / Twitter meta entries for a page (TanStack head `meta` shape). */
export function socialMeta(input: {
  title: string;
  description: string;
  url: string;
  type: "website" | "article";
  siteName: string;
  image?: string | null;
  imageAlt?: string | null;
  publishedAt?: string | null;
  modifiedAt?: string | null;
  section?: string;
}): { name?: string; property?: string; content: string }[] {
  const meta: { name?: string; property?: string; content: string }[] = [
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    { property: "og:url", content: input.url },
    { property: "og:type", content: input.type },
    { name: "twitter:card", content: input.image ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: input.title },
    { name: "twitter:description", content: input.description },
  ];
  if (input.image) {
    meta.push({ property: "og:image", content: input.image });
    meta.push({ name: "twitter:image", content: input.image });
    if (input.imageAlt?.trim()) {
      meta.push({ property: "og:image:alt", content: input.imageAlt.trim() });
      meta.push({ name: "twitter:image:alt", content: input.imageAlt.trim() });
    }
  }
  if (input.type === "article") {
    const published = isoOrNull(input.publishedAt);
    const modified = isoOrNull(input.modifiedAt);
    if (published) meta.push({ property: "article:published_time", content: published });
    if (modified) meta.push({ property: "article:modified_time", content: modified });
    if (input.section) meta.push({ property: "article:section", content: input.section });
  }
  return meta;
}
