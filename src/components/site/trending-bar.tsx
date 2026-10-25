import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { TickerEntry } from "@/content/ticker";
import { useSite, useTrending } from "./use-site";

function Item({ item, tabbable = true }: { item: TickerEntry; tabbable?: boolean }) {
  const tab = tabbable ? undefined : -1;
  if (item.slug) {
    return (
      <Link to="/articles/$slug" params={{ slug: item.slug }} className="trend__link" tabIndex={tab}>
        {item.title}
      </Link>
    );
  }
  if (item.href) {
    return (
      <a href={item.href} className="trend__link" tabIndex={tab}>
        {item.title}
      </a>
    );
  }
  return <span className="trend__link trend__text">{item.title}</span>;
}

/**
 * The top strip. Modes: "static" (a row), "scroll" (continuous marquee) or
 * "rotate" (one item at a time). Moving modes pause on hover/focus and have a
 * pause button (WCAG 2.2.2).
 */
export function TrendingBar() {
  const site = useSite();
  const items = useTrending();
  const t = site.trending;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const mode = t.mode ?? (t.animate ? "scroll" : "static");
  const moving = mode !== "static" && items.length > 1;
  useEffect(() => {
    if (mode !== "rotate" || items.length < 2 || paused || hover) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % items.length), Math.max(2, t.interval) * 1000);
    return () => window.clearInterval(timer);
  }, [mode, items.length, paused, hover, t.interval]);
  if (!t.enabled || items.length === 0) return null;
  const current = items[index % items.length];
  return (
    <div
      className={`trend trend--${mode}${paused ? " is-paused" : ""}`}
      data-mode={mode}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      <div className="container trend__row">
        <p className="trend__label grain">
          <span>{t.label}</span>
        </p>
        <div className="trend__viewport">
          {mode === "rotate" ? (
            <p className="trend__rotor" key={current?.id}>
              {current ? <Item item={current} /> : null}
              {items.length > 1 ? (
                <span className="trend__count" aria-hidden="true">
                  {(index % items.length) + 1}/{items.length}
                </span>
              ) : null}
            </p>
          ) : (
            <ul className="trend__list" style={mode === "scroll" ? { animationDuration: `${t.speed}s` } : undefined}>
              {items.map((item) => (
                <li key={item.id}>
                  <Item item={item} />
                </li>
              ))}
              {mode === "scroll"
                ? items.map((item) => (
                    <li key={`dup-${item.id}`} aria-hidden="true">
                      <Item item={item} tabbable={false} />
                    </li>
                  ))
                : null}
            </ul>
          )}
        </div>
        {moving ? (
          <button type="button" className="trend__pause" onClick={() => setPaused((p) => !p)} aria-pressed={paused} aria-label={paused ? "Play the news strip" : "Pause the news strip"}>
            {paused ? "▶" : "❚❚"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
