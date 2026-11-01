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
  coverImage?: import("./types.ts").CoverImage | null;
  motif: Article["motif"];
  minutes: number;
  rank: number;
};

export type TopicRow = { category: Category; count: number; cards: Card[] };

export type ResolvedBlock = {
  block: ContentBlock;
  title: string;
  cards: Card[];
  /** river: the "Most read" rail beside the latest stories */
  rail?: Card[];
  railTitle?: string;
  /** topicRows: one row per busy topic */
  rows?: TopicRow[];
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
  /** t115: the window the view counts cover, so "Most read" says what it ranks. */
  viewsWindow?: "week" | "all";
  /** the article being read (sidebar) */
  current?: Article | null;
  /** t115: shared "already shown" set, so later sections on the page skip these. */
  used?: Set<string>;
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
    case "river":
      return labels.latest;
    case "topicRows":
      return labels.topicRows;
    case "quickReads":
      return labels.quickReads;
    case "moreStories":
      return labels.moreStories;
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
    coverImage: article.coverImage ?? null,
    motif: article.motif,
    minutes: readingMinutes(article),
    rank: live.findIndex((a) => a.id === article.id) + 1,
  };
}

/** The lead article: the one marked featured, else the newest. */
export function leadOf(live: Article[]): Article | null {
  return live.find((a) => a.featured) ?? live[0] ?? null;
}

/** t115: ranked by topic overlap (then shared tags), newest first within a score; recent stories fill the rest. */
export function related(current: Article | null | undefined, live: Article[]): Article[] {
  if (!current) return [];
  const others = live.filter((a) => a.id !== current.id);
  const score = (a: Article) =>
    a.topicIds.filter((id) => current.topicIds.includes(id)).length * 2 + a.tagIds.filter((t) => current.tagIds.includes(t)).length;
  const same = others.filter((a) => score(a) > 0);
  const order = new Map(live.map((a, i) => [a.id, i]));
  same.sort((a, b) => score(b) - score(a) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return [...same, ...others.filter((a) => !same.includes(a))];
}

/** t96: stories per topic row (1 large + 3 small) and the fewest worth a row. */
export const TOPIC_ROW_SIZE = 4;
export const TOPIC_ROW_MIN = 3;
const RAIL_SIZE = 5;
const RAIL_MIN = 3;

/**
 * Turns configured blocks into data. Pure: unit-tested, used by the homepage,
 * the article sidebar and the admin live preview. Disabled blocks are dropped.
 *
 * On the homepage every article list skips stories already shown by a block
 * above it (t96 dedupe), so a long sectioned page never repeats itself; a
 * section with nothing left is dropped. The "Most read" rail is the one
 * exception: a ranking may repeat a story when too few unseen ones have views.
 */
export function resolveBlocks(blocks: ContentBlock[], ctx: BlockContext, where: "home" | "sidebar"): ResolvedBlock[] {
  const { site, live, categories, tags, views } = ctx;
  const home = where === "home";
  const lead = home ? leadOf(live) : null;
  const used = ctx.used ?? new Set<string>();
  if (lead) used.add(lead.id);
  if (ctx.current) used.add(ctx.current.id);
  const pool = () => live.filter((a) => !used.has(a.id));
  /** Take up to `n` stories and mark them shown (t115: the article sidebar dedupes too). */
  const take = (list: Article[], n: number): Article[] => {
    const picked = list.slice(0, n);
    for (const a of picked) used.add(a.id);
    return picked;
  };
  const mostRead = site.labels.popular;
  const windowed = (t: string) =>
    t === mostRead ? `${t}${ctx.viewsWindow === "week" ? " this week" : ctx.viewsWindow === "all" ? " (all time)" : ""}` : t;
  const card = (a: Article) => toCard(a, live, categories);
  const viewsOf = (a: Article) => views[a.id] ?? 0;
  const byViews = (list: Article[]) => list.filter((a) => viewsOf(a) > 0).sort((a, b) => viewsOf(b) - viewsOf(a));
  const countIn = (id: string) => live.filter((a) => a.topicIds.includes(id)).length;
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
      case "latest":
      case "newStories":
      case "moreStories":
        out.push({ ...base, cards: take(pool(), block.count).map(card) });
        break;
      case "related":
        out.push({ ...base, cards: take(related(ctx.current ?? lead, live).filter((a) => !used.has(a.id)), block.count).map(card) });
        break;
      case "popular":
        out.push({ ...base, title: windowed(title), cards: take(byViews(pool()), block.count).map(card) });
        break;
      case "category":
        out.push({ ...base, cards: take(pool().filter((a) => a.topicIds.includes(block.categoryId)), block.count).map(card) });
        break;
      case "tag":
        out.push({ ...base, cards: take(pool().filter((a) => a.tagIds.includes(block.tagId)), block.count).map(card) });
        break;
      case "river": {
        const cards = take(pool(), block.count).map(card);
        // Rail: most-read stories not shown yet; topped up with shown ones (never the lead) so it is never thin.
        const fresh = byViews(pool()).slice(0, RAIL_SIZE);
        const topUp = byViews(live.filter((a) => a.id !== lead?.id && !fresh.includes(a))).slice(0, RAIL_SIZE - fresh.length);
        const rail = [...fresh, ...topUp].sort((a, b) => viewsOf(b) - viewsOf(a));
        const showRail = rail.length >= RAIL_MIN;
        // t103: the rail is a ranking beside the river, not a story list, so it
        // does not consume stories; small archives keep enough for the sections below.
        out.push({ ...base, cards, rail: showRail ? rail.map(card) : [], railTitle: windowed(mostRead) });
        break;
      }
      case "topicRows": {
        const busiest = [...categories].sort((a, b) => countIn(b.id) - countIn(a.id));
        const rows: TopicRow[] = [];
        // t103: rows use at most half the unseen stories, so Quick reads,
        // related and More stories still have something to show on a small archive.
        let budget = home ? Math.floor(pool().length / 2) : Infinity;
        for (const category of busiest) {
          if (rows.length >= block.count || budget < TOPIC_ROW_MIN) break;
          const stories = pool().filter((a) => a.topicIds.includes(category.id));
          if (stories.length < TOPIC_ROW_MIN) continue;
          const picked = take(stories, Math.min(TOPIC_ROW_SIZE, budget));
          budget -= picked.length;
          rows.push({ category, count: countIn(category.id), cards: picked.map(card) });
        }
        out.push({ ...base, rows, cards: rows.flatMap((r) => r.cards) });
        break;
      }
      case "quickReads": {
        const short = pool()
          .map((a) => ({ a, m: readingMinutes(a) }))
          .sort((x, y) => x.m - y.m)
          .map((x) => x.a);
        out.push({ ...base, cards: short.length >= 2 ? take(short, block.count).map(card) : [] });
        break;
      }
      case "topics":
        out.push({
          ...base,
          topics: categories
            .map((category) => ({ category, count: countIn(category.id) }))
            .filter((t) => t.count > 0)
            .sort((a, b) => (home ? b.count - a.count : 0))
            .slice(0, block.count),
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
  // Drop blocks that came out empty, so no empty headings appear.
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
