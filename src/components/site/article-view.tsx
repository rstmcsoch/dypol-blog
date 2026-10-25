import { useRef } from "react";
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
  const toc = tocEntries(stripCreditsAndSources(article.blocks));
  const chipTopics = topics.length ? topics : category ? [category] : [];
  const corrections = article.corrections?.trim();
  return (
    <article className="article" ref={root}>
      <ReadingProgress target={root} />
      <div className="container">
        <header className="article-top">
          {chipTopics.length ? (
            <ul className="topic-chips" aria-label="Topics">
              {chipTopics.map((topic) => (
                <li key={topic.id}>
                  <Link to="/topics/$slug" params={{ slug: topic.slug }} className="topic-chip">
                    {topic.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <h1 className="article-title">{article.title}</h1>
          <p className="lede">{article.excerpt}</p>
          <p className="meta">
            <span>by {site.publisher}</span>
            {article.publishedAt ? <span>{formatDate(article.publishedAt)}</span> : null}
            {isMeaningfullyUpdated(article.publishedAt, article.updatedAt) ? <span>Updated {formatDate(article.updatedAt)}</span> : null}
            <span>
              {readingMinutes(article)} {site.labels.minRead}
            </span>
            {article.status !== "published" ? <span>{article.status}</span> : null}
          </p>
        </header>
        {hasCover(article.coverMediaId, fallback) ? (
          <div className="article-plate">
            <Cover
              mediaId={article.coverMediaId}
              alt={article.coverAlt}
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
            before={toc.length ? <TableOfContents entries={toc} /> : null}
            after={
              <>
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
            <aside className="article-aside">
              <SidebarBlocks blocks={blocks} site={site} title={article.title} slug={article.slug} />
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
