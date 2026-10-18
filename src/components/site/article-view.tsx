import { Link } from "@tanstack/react-router";
import type { ArticleMeta } from "@/content/present";
import { readingMinutes } from "@/content/present";
import type { Article, Category, SiteConfig, Tag } from "@/content/types";
import { formatDate, padIndex } from "@/lib/format";
import { ArticleBody } from "./article-body";
import { Cover, hasCover } from "./cover";
import { ShareLinks } from "./share";
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
  alsoLike = [],
  latest = [],
}: {
  article: Article;
  category: Category | null;
  tags: Tag[];
  related: Article[];
  neighbors: { newer?: Article; older?: Article };
  rank: number;
  meta: Record<string, ArticleMeta>;
  site: SiteConfig;
  alsoLike?: { id: string; slug: string; title: string }[];
  latest?: { id: string; slug: string; title: string; publishedAt: string | null }[];
}) {
  const sidebar = site.articleSidebar;
  const blocks = sidebar.enabled
    ? sidebar.blocks.filter((block) =>
        block === "tags" ? tags.length > 0 : block === "related" ? alsoLike.length > 0 : block === "newStories" ? latest.length > 0 : true,
      )
    : [];
  const fallback = site.appearance.coverFallback;
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
        {hasCover(article.coverMediaId, fallback) ? (
          <div className="article-plate">
            <Cover
              mediaId={article.coverMediaId}
              fallback={fallback}
              motif={article.motif}
              index={padIndex(rank || 1)}
              category={category?.label ?? ""}
              title={article.title}
            />
          </div>
        ) : null}
        <div className={blocks.length > 0 ? "article-layout" : "article-layout article-layout--full"}>
          <ArticleBody blocks={article.blocks} />
          {blocks.length > 0 ? (
            <aside className="article-aside">
              {blocks.map((block) => {
                if (block === "tags") {
                  return (
                    <div className="aside-block" key="tags">
                      <h2 className="aside-head">{site.labels.tags}</h2>
                      <ul className="tag-list">
                        {tags.map((tag) => (
                          <li key={tag.id}>{tag.label}</li>
                        ))}
                      </ul>
                    </div>
                  );
                }
                if (block === "share") {
                  return (
                    <ShareLinks
                      key="share"
                      title={article.title}
                      path={`/articles/${article.slug}`}
                      label={site.labels.share}
                      copyLabel={site.labels.copyLink}
                      copiedLabel={site.labels.linkCopied}
                    />
                  );
                }
                const list = block === "related" ? alsoLike : latest;
                return (
                  <div className="aside-block" key={block}>
                    <h2 className="aside-head">{block === "related" ? site.labels.alsoLike : site.labels.newStories}</h2>
                    <ul className="aside-list">
                      {list.map((item) => (
                        <li key={item.id}>
                          <Link to="/articles/$slug" params={{ slug: item.slug }}>
                            {item.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
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
