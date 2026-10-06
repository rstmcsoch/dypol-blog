import { Link } from "@tanstack/react-router";
import { useSite, useTrending } from "./use-site";

export function TrendingBar() {
  const site = useSite();
  const items = useTrending();
  if (!site.trending.enabled || items.length === 0) return null;
  return (
    <div className="trend">
      <div className="container trend__row">
        <p className="trend__label">
          <span className="grain-layer" aria-hidden="true" />
          <span>{site.trending.label}</span>
        </p>
        <ul className="trend__list">
          {items.map((article) => (
            <li key={article.id}>
              <Link to="/articles/$slug" params={{ slug: article.slug }} className="trend__link">
                {article.title}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
