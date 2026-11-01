import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { stripCreditsAndSources } from "@/lib/automation/body";
import { ReadingProgress, TableOfContents, tocEntries } from "./reading-aids";
import type { ArticleMeta } from "@/content/present";
import { readingMinutes } from "@/content/present";
import type { Article, Category, SiteConfig, Tag } from "@/content/types";
import { formatDate, isMeaningfullyUpdated, padIndex } from "@/lib/format";
import { ArticleBody } from "./article-body";
import { Cover, hasCover } from "./cover";
import { SidebarBlocks } from "./blocks";
import type { ResolvedBlock } from "@/content/blocks";
import { IndexList } from "./index-list";
import { AdSlot, SponsoredBy, useAds, useSlotActive } from "./ads";
import { inTextPositions } from "@/lib/ads/model";
import { parseEmbed } from "@/lib/social-embed";
import type { ReactNode } from "react";

export function ArticleView({
  article,
  category,
  topics = [],
  tags,
  related,
  neighbors,
  rank,
  meta,
  site,
  sidebar = [],
  inlineRelated = [],
}: {
  inlineRelated?: { id: string; slug: string; title: string; publishedAt: string | null }[];
  article: Article;
  category: Category | null;
  topics?: Category[];
  tags: Tag[];
  related: Article[];
  neighbors: { newer?: Article; older?: Article };
  rank: number;
  meta: Record<string, ArticleMeta>;
  site: SiteConfig;
  sidebar?: ResolvedBlock[];
}) {
  const blocks = sidebar;
  const fallback = site.appearance.coverFallback;
  const root = useRef<HTMLElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  useAsideHeight(asideRef);
  const toc = tocEntries(stripCreditsAndSources(article.blocks));
  const chipTopics = topics.length ? topics : category ? [category] : [];
  const corrections = article.corrections?.trim();
  const inserts = useInTextAds(article.blocks);
  return (
    <article className="article" ref={root}>
      <ReadingProgress target={root} />
      <div className="container">
        <header className="article-top">
          <h1 className="article-title">{article.title}</h1>
          <p className="lede">{article.excerpt}</p>
          <p className="meta">
            <span className="byline">by {article.authorName?.trim() || site.publisher}</span>
            {article.publishedAt ? <span>{formatDate(article.publishedAt)}</span> : null}
            {isMeaningfullyUpdated(article.publishedAt, article.updatedAt) ? <span>Updated {formatDate(article.updatedAt)}</span> : null}
            <span>
              {readingMinutes(article)} {site.labels.minRead}
            </span>
            {article.status !== "published" ? <span>{article.status}</span> : null}
          </p>
          <SponsoredBy slug={article.slug} />
        </header>
        {hasCover(article.coverMediaId, fallback) ? (
          <div className="article-plate">
            <Cover
              mediaId={article.coverMediaId}
              alt={article.coverAlt}
              image={article.coverImage}
              priority
              fallback={fallback}
              motif={article.motif}
              index={padIndex(rank || 1)}
              category={category?.label ?? ""}
              title={article.title}
            />
          </div>
        ) : null}
        <div className={blocks.length > 0 ? "article-layout" : "article-layout article-layout--full"}>
          <ArticleBody
            blocks={article.blocks}
            inserts={inserts}
            before={toc.length ? <TableOfContents entries={toc} /> : null}
            after={
              <>
                {chipTopics.length ? (
                  <ul className="topic-chips topic-chips--end" aria-label="Topics">
                    {chipTopics.map((topic) => (
                      <li key={topic.id}>
                        <Link to="/topics/$slug" params={{ slug: topic.slug }} className="topic-chip">
                          {topic.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <AdSlot id="A4" />
                {inlineRelated.length >= 2 ? (
                  <aside className="article-related" aria-labelledby="article-related-title">
                    <h2 id="article-related-title">Related</h2>
                    <ul>
                      {inlineRelated.map((r) => (
                        <li key={r.id}>
                          <Link to="/articles/$slug" params={{ slug: r.slug }}>{r.title}</Link>
                        </li>
                      ))}
                    </ul>
                  </aside>
                ) : null}
                {corrections ? (
                  <aside className="article-corrections" aria-labelledby="article-corrections-title">
                    <h2 id="article-corrections-title">Correction</h2>
                    <p>{corrections}</p>
                  </aside>
                ) : null}
              </>
            }
          />
          {blocks.length > 0 ? (
            <aside className="article-aside" ref={asideRef}>
              <SidebarBlocks blocks={blocks} site={site} title={article.title} slug={article.slug} adAfterRelated={<AdSlot id="A3" />} />
              <AdSlot id="A3b" />
            </aside>
          ) : null}
        </div>
        {(neighbors.newer || neighbors.older) && (
          <nav className="neighbor-list" aria-label={site.labels.neighbors}>
            {neighbors.newer ? (
              <Link to="/articles/$slug" params={{ slug: neighbors.newer.slug }} className="neighbor">
                <span>{site.labels.newer}</span>
                <strong>{neighbors.newer.title}</strong>
              </Link>
            ) : null}
            {neighbors.older ? (
              <Link to="/articles/$slug" params={{ slug: neighbors.older.slug }} className="neighbor">
                <span>{site.labels.older}</span>
                <strong>{neighbors.older.title}</strong>
              </Link>
            ) : null}
          </nav>
        )}
        {related.length > 0 ? <AdSlot id="A5" /> : null}
        {related.length > 0 ? (
          <section className="section" aria-labelledby="continue">
            <h2 id="continue">{site.labels.related}</h2>
            <IndexList articles={related} meta={meta} minRead={site.labels.minRead} />
          </section>
        ) : null}
      </div>
    </article>
  );
}

/** t148: A1 after paragraph N, then A2 (repeated up to the owner's max), only at a natural break (before a paragraph or heading). */
function useInTextAds(blocks: Article["blocks"]): Record<number, ReactNode> | undefined {
  const ads = useAds();
  const a1 = useSlotActive("A1");
  const a2 = useSlotActive("A2");
  if (!a1 && !a2) return undefined;
  const prose = stripCreditsAndSources(blocks);
  const rules = ads?.rules ?? { maxInText: 2, paragraphsBetween: 2, firstAfterParagraph: 2, a2MinParagraphs: 5 };
  const shapes = prose.map((b) => ({ type: b.type, embed: b.type === "paragraph" && !!parseEmbed(b.text) }));
  const out: Record<number, ReactNode> = {};
  inTextPositions(shapes, rules).forEach((index, n) => {
    out[index] = n === 0 ? <AdSlot id="A1" /> : <AdSlot id="A2" occurrence={n - 1} />;
  });
  return out;
}

/** t167: publish the sidebar's height so its sticky offset can keep its bottom (the ad) on screen. */
function useAsideHeight(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Up to the bottom of its last visible box (a trailing ad margin is not content).
    const set = () => {
      const top = el.getBoundingClientRect().top;
      let bottom = 0;
      for (const c of Array.from(el.children)) {
        const r = c.getBoundingClientRect();
        if (r.height > 0 && r.bottom - top > bottom) bottom = r.bottom - top;
      }
      el.style.setProperty("--aside-h", `${Math.ceil(bottom || el.offsetHeight)}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}
