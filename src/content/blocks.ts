import { readingMinutes } from "./present.ts";
import { tickerEntries, type TickerEntry } from "./ticker.ts";
import type { Article, Category, ContentBlock, SiteConfig, SiteLabels, Tag } from "./types.ts";

/** Small, serialisable article card used by every block. */
export type Card = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string | null;
  categoryLabel: string;
  /** Labels of every topic the article is filed under, primary first. */
  topicLabels: string[];
  coverMediaId: string | null;
  coverAlt: string | null;
  motif: Article["motif"];
  minutes: number;
  rank: number;
};

export type ResolvedBlock = {
  block: ContentBlock;
  title: string;
  cards: Card[];
  topics?: { category: Category; count: number }[];
  ticker?: TickerEntry[];
  tags?: Tag[];
};

export type BlockContext = {
  site: SiteConfig;
  live: Article[];
  categories: Category[];
  tags: Tag[];
  /** article id -> views (may be empty) */
  views: Record<string, number>;
  /** the article being read (sidebar) */
  current?: Article | null;
};

/** Default headings come from Site text, so renaming a label still works. */
export function defaultTitle(block: ContentBlock, labels: SiteLabels, categories: Category[], tags: Tag[]): string {
  switch (block.type) {
    case "featured":
      return labels.featured;
    case "also":
      return labels.also;
    case "latest":
      return labels.latest;
    case "related":
      return labels.alsoLike;
    case "popular":
      return labels.popular;
    case "topics":
      return labels.topics;
    case "ticker":
      return labels.newStories;
    case "newStories":
      return labels.newStories;
    case "tags":
      return labels.tags;
    case "share":
      return labels.share;
    case "category":
      return categories.find((c) => c.id === block.categoryId)?.label ?? labels.topics;
    case "tag":
      return tags.find((t) => t.id === block.tagId)?.label ?? labels.tags;
    default:
      return "";
  }
}

export function toCard(article: Article, live: Article[], categories: Category[]): Card {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    publishedAt: article.publishedAt,
    categoryLabel: categories.find((c) => c.id === article.categoryId)?.label ?? "",
    topicLabels: article.topicIds.map((id) => categories.find((c) => c.id === id)?.label ?? "").filter(Boolean),
    coverMediaId: article.coverMediaId ?? null,
    coverAlt: article.coverAlt ?? null,
    motif: article.motif,
    minutes: readingMinutes(article),
    rank: live.findIndex((a) => a.id === article.id) + 1,
  };
}

/** The lead article: the one marked featured, else the newest. */
export function leadOf(live: Article[]): Article | null {
  return live.find((a) => a.featured) ?? live[0] ?? null;
}

function related(current: Article | null | undefined, live: Article[]): Article[] {
  if (!current) return [];
  const others = live.filter((a) => a.id !== current.id);
  const shared = (a: Article) => a.tagIds.filter((t) => current.tagIds.includes(t)).length;
  const sameTopic = (a: Article) => a.topicIds.some((id) => current.topicIds.includes(id));
  const same = others.filter((a) => sameTopic(a) || shared(a) > 0);
  same.sort((a, b) => shared(b) - shared(a));
  return [...same, ...others.filter((a) => !same.includes(a))];
}

/**
 * Turns configured blocks into data. Pure: unit-tested, used by the homepage,
 * the article sidebar and the admin live preview. Disabled blocks are dropped;
 * article lists never repeat the lead on the homepage.
 */
export function resolveBlocks(blocks: ContentBlock[], ctx: BlockContext, where: "home" | "sidebar"): ResolvedBlock[] {
  const { site, live, categories, tags, views } = ctx;
  const lead = where === "home" ? leadOf(live) : null;
  const pool = live.filter((a) => a.id !== lead?.id && a.id !== ctx.current?.id);
  // On the homepage "also" takes the first stories and "latest" continues after it, as before.
  const alsoBlock = where === "home" ? blocks.find((b) => b.type === "also" && b.enabled) : undefined;
  const alsoCount = alsoBlock?.count ?? 0;
  const card = (a: Article) => toCard(a, live, categories);
  const out: ResolvedBlock[] = [];
  for (const block of blocks) {
    if (!block.enabled) continue;
    const title = block.title || defaultTitle(block, site.labels, categories, tags);
    const base = { block, title, cards: [] as Card[] };
    switch (block.type) {
      case "featured":
        if (lead) out.push({ ...base, cards: [card(lead)] });
        break;
      case "also":
        out.push({ ...base, cards: pool.slice(0, block.count).map(card) });
        break;
      case "latest":
      case "newStories":
        out.push({ ...base, cards: pool.slice(block.type === "latest" ? alsoCount : 0).slice(0, block.count).map(card) });
        break;
      case "related":
        out.push({ ...base, cards: related(ctx.current ?? lead, live).filter((a) => a.id !== lead?.id).slice(0, block.count).map(card) });
        break;
      case "popular": {
        const ranked = [...pool].filter((a) => (views[a.id] ?? 0) > 0).sort((a, b) => (views[b.id] ?? 0) - (views[a.id] ?? 0));
        out.push({ ...base, cards: ranked.slice(0, block.count).map(card) });
        break;
      }
      case "category":
        out.push({ ...base, cards: pool.filter((a) => a.topicIds.includes(block.categoryId)).slice(0, block.count).map(card) });
        break;
      case "tag":
        out.push({ ...base, cards: pool.filter((a) => a.tagIds.includes(block.tagId)).slice(0, block.count).map(card) });
        break;
      case "topics":
        out.push({
          ...base,
          topics: categories.slice(0, block.count).map((category) => ({ category, count: live.filter((a) => a.topicIds.includes(category.id)).length })),
        });
        break;
      case "ticker":
        out.push({ ...base, ticker: tickerEntries({ ...site, trending: { ...site.trending, enabled: true, count: block.count } }, live, views) });
        break;
      case "tags": {
        // On an article: that article's tags. On the homepage: every tag.
        const list = ctx.current ? ctx.current.tagIds.map((id) => tags.find((t) => t.id === id)).filter((t): t is Tag => Boolean(t)) : tags.slice(0, block.count);
        out.push({ ...base, tags: list });
        break;
      }
      default:
        out.push(base); // text, cta, share render from the block itself
    }
  }
  // Drop article blocks that came out empty, so no empty headings appear.
  return out.filter((r) => {
    const t = r.block.type;
    if (t === "text") return r.block.body.trim().length > 0;
    if (t === "cta" || t === "share") return true;
    if (t === "topics") return (r.topics?.length ?? 0) > 0;
    if (t === "ticker") return (r.ticker?.length ?? 0) > 0;
    if (t === "tags") return (r.tags?.length ?? 0) > 0;
    return r.cards.length > 0;
  });
}
