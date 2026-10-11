import { Link } from "@tanstack/react-router";
import { formatDate, padIndex } from "@/lib/format";
import type { ArticleMeta } from "@/content/present";
import type { Article } from "@/content/types";

export function IndexList({
  articles,
  meta,
  minRead,
}: {
  articles: Article[];
  meta: Record<string, ArticleMeta>;
  minRead: string;
}) {
  return (
    <ol className="index-list">
      {articles.map((article) => {
        const row = meta[article.id];
        return (
          <li key={article.id}>
            <Link to="/articles/$slug" params={{ slug: article.slug }} className="index-row">
              <span className="index-row__num">{padIndex(row?.rank ?? 0)}</span>
              <span className="index-row__main">
                <span className="index-row__title">{article.title}</span>
                <span className="index-row__excerpt">{article.excerpt}</span>
              </span>
              <span className="index-row__meta">
                {row?.categoryLabel ? <span>{row.categoryLabel}</span> : null}
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