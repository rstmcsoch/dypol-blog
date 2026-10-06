import { Link } from "@tanstack/react-router";
import type { ArticleMeta } from "@/content/present";
import { readingMinutes } from "@/content/present";
import type { Article, Category, SiteConfig, Tag } from "@/content/types";
import { formatDate, padIndex } from "@/lib/format";
import { ArticleBody } from "./article-body";
import { CoverPlate } from "./cover-plate";
import { IndexList } from "./index-list";

export function ArticleView({
  article,
  category,
  tags,
  related,
  neighbors,
  rank,
  meta,
  site,
}: {
  article: Article;
  category: Category | null;
  tags: Tag[];
  related: Article[];
  neighbors: { newer?: Article; older?: Article };
  rank: number;
  meta: Record<string, ArticleMeta>;
  site: SiteConfig;
}) {
  return (
    <article className="article">
      <div className="container">
        <header className="article-top">
          {category ? (
            <p className="article-kicker">
              <Link to="/topics/$slug" params={{ slug: category.slug }}>
                {category.label}
              </Link>
            </p>
          ) : null}
          <h1 className="article-title">{article.title}</h1>
          <p className="lede">{article.excerpt}</p>
          <p className="meta">
            {article.publishedAt ? <span>{formatDate(article.publishedAt)}</span> : null}
            <span>
              {readingMinutes(article)} {site.labels.minRead}
            </span>
            {article.status !== "published" ? <span>{article.status}</span> : null}
          </p>
        </header>
        <div className="article-plate">
          {article.coverMediaId ? (
            <img className="article-cover" src={`/media/${article.coverMediaId}`} alt="" />
          ) : (
            <CoverPlate motif={article.motif} index={padIndex(rank || 1)} category={category?.label ?? ""} />
          )}
        </div>
        <div className="article-layout">
          <ArticleBody blocks={article.blocks} />
          <aside className="article-aside">
            {tags.length > 0 ? (
              <ul className="tag-list" aria-label="Tags">
                {tags.map((tag) => (
                  <li key={tag.id}>{tag.label}</li>
                ))}
              </ul>
            ) : null}
          </aside>
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
