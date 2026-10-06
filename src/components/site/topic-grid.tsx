import { Link } from "@tanstack/react-router";
import { padIndex } from "@/lib/format";
import { listCategories, publishedCount } from "@/content/queries";

export function TopicGrid() {
  return (
    <ul className="topic-grid">
      {listCategories().map((category) => (
        <li key={category.id}>
          <Link to="/topics/$slug" params={{ slug: category.slug }} className="topic-card">
            <span className="topic-card__count">{padIndex(publishedCount(category.id))}</span>
            <span className="topic-card__label">{category.label}</span>
            <span className="topic-card__desc">{category.description}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
