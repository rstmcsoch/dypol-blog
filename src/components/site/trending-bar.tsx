import { Link } from "@tanstack/react-router";
import type { TickerEntry } from "@/content/ticker";
import { useSite, useTrending } from "./use-site";

function Item({ item }: { item: TickerEntry }) {
  if (item.slug) {
    return (
      <Link to="/articles/$slug" params={{ slug: item.slug }} className="trend__link">
        {item.title}
      </Link>
    );
  }
  if (item.href) {
    return (
      <a href={item.href} className="trend__link">
        {item.title}
      </a>
    );
  }
  return <span className="trend__link trend__text">{item.title}</span>;
}

export function TrendingBar() {
  const site = useSite();
  const items = useTrending();
  const t = site.trending;
  if (!t.enabled || items.length === 0) return null;
  const animate = t.animate;
  return (
    <div className={animate ? "trend trend--animate" : "trend"}>
      <div className="container trend__row">
        <p className="trend__label">
          <span className="grain-layer" aria-hidden="true" />
          <span>{t.label}</span>
        </p>
        <div className="trend__viewport">
          <ul className="trend__list" style={animate ? { animationDuration: `${t.speed}s` } : undefined}>
            {items.map((item) => (
              <li key={item.id}>
                <Item item={item} />
              </li>
            ))}
            {animate
              ? items.map((item) => (
                  <li key={`dup-${item.id}`} aria-hidden="true">
                    <span className="trend__link">{item.title}</span>
                  </li>
                ))
              : null}
          </ul>
        </div>
      </div>
    </div>
  );
}
