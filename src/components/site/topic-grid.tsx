import { Link } from "@tanstack/react-router";
import { padIndex } from "@/lib/format";
import type { Category } from "@/content/types";

export function TopicGrid({ topics }: { topics: { category: Category; count: number }[] }) {
  return (
    <ul className="topic-grid">
      {topics.map(({ category, count }) => (
        <li key={category.id}>
          <Link to="/topics/$slug" params={{ slug: category.slug }} className="topic-card">
            <span className="topic-card__count">{padIndex(count)}</span>
            <span className="topic-card__label">{category.label}</span>
            <span className="topic-card__desc">{category.description}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}