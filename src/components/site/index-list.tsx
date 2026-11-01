import { Link } from "@tanstack/react-router";
import { formatDate, padIndex } from "@/lib/format";
import type { ArticleMeta } from "@/content/present";
import type { Article } from "@/content/types";
import { thumbUrl } from "@/lib/media-url";

export function IndexList({
  articles,
  meta,
  minRead,
  start = 0,
}: {
  articles: Article[];
  meta: Record<string, ArticleMeta>;
  minRead: string;
  /** t115: numbers count 1..N within this list (plus the page offset), never a global rank. */
  start?: number;
}) {
  return (
    <ol className="index-list">
      {articles.map((article, i) => {
        const row = meta[article.id];
        return (
          <li key={article.id}>
            <Link to="/articles/$slug" params={{ slug: article.slug }} className="index-row">
              <span className="index-row__num">{padIndex(start + i + 1)}</span>
              {article.coverMediaId ? (
                <span className="index-row__thumb"><img src={thumbUrl(article.coverMediaId, article.coverImage?.v)} style={article.coverImage?.c ? { backgroundColor: article.coverImage.c } : undefined} alt={article.coverAlt?.trim() ? article.coverAlt : article.title} loading="lazy" decoding="async" width={480} height={360} /></span>
              ) : (
                <span className="index-row__thumb index-row__thumb--empty" aria-hidden="true">{row?.categoryLabel ?? ""}</span>
              )}
              <span className="index-row__main">
                <span className="index-row__title">{article.title}</span>
                <span className="index-row__excerpt">{article.excerpt}</span>
              </span>
              <span className="index-row__meta">
                {row?.topicLabels?.length ? <span>{row.topicLabels.slice(0, 2).join(" · ")}{row.topicLabels.length > 2 ? ` +${row.topicLabels.length - 2}` : ""}</span> : null}
                {article.publishedAt ? <span>{formatDate(article.publishedAt)}</span> : null}
                <span>
                  {row?.minutes ?? 1} {minRead}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}