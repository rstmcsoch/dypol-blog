import type { Article, SiteConfig } from "./types";

/** Items for the top strip, from the owner's chosen source. Pure. */
export type TickerEntry = { id: string; title: string; slug: string | null; href: string | null };

/**
 * Picks the strip's items. If the chosen source yields nothing (no pinned
 * article is still published, no custom items, no views counted yet), it falls
 * back to the newest articles, so the strip never silently disappears.
 */
export function tickerEntries(site: SiteConfig, live: Article[], views: Record<string, number> = {}): TickerEntry[] {
  const t = site.trending;
  if (!t.enabled) return [];
  const fromArticle = (article: Article): TickerEntry => ({ id: article.id, title: article.title, slug: article.slug, href: null });
  const latest = () => live.slice(0, t.count).map(fromArticle);
  let items: TickerEntry[] = [];
  if (t.source === "custom") {
    items = t.customItems.slice(0, t.count).map((item) => ({ id: item.id, title: item.text, slug: null, href: item.href || null }));
  } else if (t.source === "latest") {
    items = latest();
  } else if (t.source === "popular") {
    items = [...live]
      .filter((a) => (views[a.id] ?? 0) > 0)
      .sort((a, b) => (views[b.id] ?? 0) - (views[a.id] ?? 0))
      .slice(0, t.count)
      .map(fromArticle);
  } else {
    items = t.slugs
      .map((slug) => live.find((article) => article.slug === slug))
      .filter((article): article is Article => Boolean(article))
      .slice(0, t.count)
      .map(fromArticle);
  }
  return items.length > 0 ? items : latest();
}
