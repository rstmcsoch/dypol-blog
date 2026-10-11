import type { Article, SiteConfig } from "./types";

/** Items for the top strip, from the owner's chosen source. Pure. */
export type TickerEntry = { id: string; title: string; slug: string | null; href: string | null };

export function tickerEntries(site: SiteConfig, live: Article[]): TickerEntry[] {
  const t = site.trending;
  if (!t.enabled) return [];
  const fromArticle = (article: Article): TickerEntry => ({ id: article.id, title: article.title, slug: article.slug, href: null });
  if (t.source === "custom") {
    return t.customItems.slice(0, t.count).map((item) => ({ id: item.id, title: item.text, slug: null, href: item.href || null }));
  }
  if (t.source === "latest") return live.slice(0, t.count).map(fromArticle);
  return t.slugs
    .map((slug) => live.find((article) => article.slug === slug))
    .filter((article): article is Article => Boolean(article))
    .slice(0, t.count)
    .map(fromArticle);
}

