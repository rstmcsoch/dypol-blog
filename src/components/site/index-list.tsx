import { Link } from "@tanstack/react-router";
import { site } from "@/content/site";
import { formatDate, padIndex } from "@/lib/format";
import { getCategory, rankOf, readingMinutes } from "@/content/queries";
import type { Article } from "@/content/types";

export function IndexList({ articles }: { articles: Article[] }) {
  return (
    <ol className="index-list">
      {articles.map((article) => {
        const category = getCategory(article.categoryId);
        return (
          <li key={article.id}>
            <Link to="/articles/$slug" params={{ slug: article.slug }} className="index-row">
              <span className="index-row__num">{padIndex(rankOf(article.slug))}</span>
              <span className="index-row__main">
                <span className="index-row__title">{article.title}</span>
                <span className="index-row__excerpt">{article.excerpt}</span>
              </span>
              <span className="index-row__meta">
                {category ? <span>{category.label}</span> : null}
                {article.publishedAt ? <span>{formatDate(article.publishedAt)}</span> : null}
                <span>
                  {readingMinutes(article)} {site.labels.minRead}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
