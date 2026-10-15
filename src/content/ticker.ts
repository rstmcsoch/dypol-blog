import type { Article, SiteConfig } from "./types";

/**
 * Items for the strip under the masthead. Pure: everything it needs — live
 * articles, view counts, topics, featured flags — is passed in, so the same
 * function powers the public strip and the desk preview.
 *
 * Honesty rules:
 *  - only published articles are ever passed in;
 *  - "trending" uses real recorded views. When nothing has been recorded yet it
 *    falls back to the newest articles and says so (`fallback: true`), rather
 *    than presenting invented numbers;
 *  - missing pinned slugs, empty topics and stale custom items never produce an
 *    empty or broken strip: it falls back to the newest articles and reports it.
 */
export type TickerEntry = {
  id: string;
  title: string;
  slug: string | null;
  href: string | null;
  /** Recorded views, only when they are real. */
  views?: number;
};

export type TickerContext = {
  views?: Map<string, number>;
  categories?: Map<string, string>;
  featured?: Set<string>;
};

export type ResolvedTicker = {
  items: TickerEntry[];
  /** The source that actually produced the items. */
  source: SiteConfig["trending"]["source"];
  /** true when the chosen source had nothing and the newest articles were used. */
  fallback: boolean;
  /** Why the fallback happened, for the desk ("No view data recorded yet"). */
  note: string;
};

const fromArticle = (article: Article, views?: number): TickerEntry => ({
  id: article.id,
  title: article.title,
  slug: article.slug,
  href: null,
  ...(views === undefined ? {} : { views }),
});

function dedupe(items: TickerEntry[]): TickerEntry[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.slug ?? `custom:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveTicker(site: SiteConfig, live: Article[], context: TickerContext = {}): ResolvedTicker {
  const config = site.trending;
  if (!config.enabled) return { items: [], source: config.source, fallback: false, note: "The strip is switched off." };
  if (live.length === 0) return { items: [], source: config.source, fallback: false, note: "No published articles yet." };

  const views = context.views ?? new Map<string, number>();
  const newest = [...live].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  const newestEntries = () => newest.map((article) => fromArticle(article, views.get(article.id)));
  const count = Math.max(1, config.count);

  if (config.source === "custom") {
    const items = dedupe(
      config.customItems
        .filter((item) => item.text.trim().length > 0)
        .map((item) => ({ id: item.id, title: item.text.trim(), slug: null, href: item.href || null })),
    ).slice(0, count);
    return { items, source: "custom", fallback: false, note: items.length === 0 ? "No custom items yet." : "" };
  }

  if (config.source === "pinned") {
    const uniqueSlugs = [...new Set(config.slugs)];
    const missingCount = uniqueSlugs.filter((slug) => !live.some((article) => article.slug === slug)).length;
    const items = dedupe(
      uniqueSlugs
        .map((slug) => live.find((article) => article.slug === slug))
        .filter((article): article is Article => Boolean(article))
        .map((article) => fromArticle(article, views.get(article.id))),
    ).slice(0, count);
    if (items.length > 0) {
      const note =
        missingCount > 0
          ? `${missingCount} pinned article${missingCount === 1 ? " is" : "s are"} not published and ${missingCount === 1 ? "was" : "were"} skipped.`
          : "";
      return { items, source: "pinned", fallback: false, note };
    }
    return { items: newestEntries().slice(0, count), source: "latest", fallback: true, note: "None of the pinned articles are published — showing the newest instead." };
  }

  if (config.source === "featured") {
    const featuredId = context.featured ?? new Set(live.filter((article) => article.featured).map((article) => article.id));
    const items = newest
      .filter((article) => featuredId.has(article.id))
      .map((article) => fromArticle(article, views.get(article.id)))
      .slice(0, count);
    if (items.length > 0) return { items, source: "featured", fallback: false, note: "" };
    return { items: newestEntries().slice(0, count), source: "latest", fallback: true, note: "Nothing is marked featured — showing the newest instead." };
  }

  if (config.source === "category") {
    const wanted = new Set(config.categories);
    const items = newest
      .filter((article) => wanted.has(article.categoryId) || wanted.has(context.categories?.get(article.categoryId) ?? ""))
      .map((article) => fromArticle(article, views.get(article.id)))
      .slice(0, count);
    if (items.length > 0) return { items, source: "category", fallback: false, note: "" };
    return { items: newestEntries().slice(0, count), source: "latest", fallback: true, note: "No published articles in the chosen topics — showing the newest instead." };
  }

  if (config.source === "trending") {
    const ranked = [...live]
      .map((article) => ({ article, views: views.get(article.id) ?? 0 }))
      .filter((row) => row.views > 0)
      .sort((a, b) => b.views - a.views || (b.article.publishedAt ?? "").localeCompare(a.article.publishedAt ?? ""));
    if (ranked.length > 0) {
      return {
        items: ranked.slice(0, count).map((row) => fromArticle(row.article, row.views)),
        source: "trending",
        fallback: false,
        note: "",
      };
    }
    return {
      items: newestEntries().slice(0, count),
      source: "latest",
      fallback: true,
      note: "No reading data recorded yet — showing the newest articles until views build up.",
    };
  }

  return { items: newestEntries().slice(0, count), source: "latest", fallback: false, note: "" };
}

/** Back-compat wrapper for callers that only need the items. */
export function tickerEntries(site: SiteConfig, live: Article[], context: TickerContext = {}): TickerEntry[] {
  return resolveTicker(site, live, context).items;
}
