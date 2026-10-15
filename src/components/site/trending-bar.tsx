import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { TickerEntry } from "@/content/ticker";
import { useSite, useTrending } from "./use-site";

/**
 * The strip under the masthead.
 *
 * Default behaviour ("rotate"): exactly one headline is shown at a time and it
 * advances on the owner's interval, so nothing is hidden behind a horizontal
 * scroll and nothing overflows on a phone. Visitors who prefer reduced motion
 * (or whose browser sets it) get no automatic movement; the arrows still work.
 *
 * The owner can also switch the strip to a single still headline, or keep the
 * older continuous marquee ("animate") — that path is unchanged.
 */

function Headline({ item }: { item: TickerEntry }) {
  if (item.slug) {
    return (
      <Link to="/articles/$slug" params={{ slug: item.slug }} className="trend__link">
        {item.title}
      </Link>
    );
  }
  if (item.href) {
    return (
      <a href={item.href} className="trend__link" rel="noreferrer">
        {item.title}
      </a>
    );
  }
  return <span className="trend__link trend__text">{item.title}</span>;
}

export function TrendingBar() {
  const site = useSite();
  const items = useTrending();
  const config = site.trending;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setStill(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  const count = items.length;
  const rounded = index % Math.max(1, count);

  useEffect(() => {
    if (config.animate || config.mode === "still" || count < 2) return;
    if (still) return;
    if (paused && config.pauseOnHover) return;
    const seconds = Math.min(60, Math.max(3, config.intervalSeconds || 6));
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % count), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [config.animate, config.intervalSeconds, config.mode, config.pauseOnHover, count, paused, still]);

  const step = (direction: -1 | 1) => setIndex((current) => (current + direction + count) % count);
  const label = useMemo(() => config.label, [config.label]);

  if (!config.enabled || count === 0) return null;

  const marquee = config.animate;
  return (
    <div
      className={marquee ? "trend trend--animate" : "trend"}
      role="region"
      aria-label={label || "Trending"}
      onMouseEnter={config.pauseOnHover ? () => setPaused(true) : undefined}
      onMouseLeave={config.pauseOnHover ? () => setPaused(false) : undefined}
      onFocusCapture={config.pauseOnHover ? () => setPaused(true) : undefined}
      onBlurCapture={config.pauseOnHover ? () => setPaused(false) : undefined}
      onKeyDown={
        !marquee && count > 1
          ? (event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                step(-1);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                step(1);
              }
            }
          : undefined
      }
    >
      <div className="container trend__row">
        {config.showLabel && label ? (
          <p className="trend__label">
            <span className="grain-layer" aria-hidden="true" />
            <span>{label}</span>
          </p>
        ) : null}
        <div className="trend__viewport">
          <ul className="trend__list" style={marquee ? { animationDuration: `${config.speed}s` } : undefined}>
            {marquee ? (
              <>
                {items.map((item) => (
                  <li key={item.id}>
                    <Headline item={item} />
                  </li>
                ))}
                {items.map((item) => (
                  <li key={`dup-${item.id}`} aria-hidden="true">
                    <span className="trend__link">{item.title}</span>
                  </li>
                ))}
              </>
            ) : (
              <li className="trend__slot" key={items[rounded]?.id ?? "empty"}>
                {items[rounded] ? <Headline item={items[rounded] as TickerEntry} /> : null}
              </li>
            )}
          </ul>
        </div>
        {!marquee && count > 1 ? (
          <div className="trend__controls">
            {config.showIndex ? (
              <p className="trend__count" aria-live="polite">
                {rounded + 1} / {count}
              </p>
            ) : null}
            <button type="button" className="trend__step" onClick={() => step(-1)} aria-label="Previous headline">
              ‹
            </button>
            <button type="button" className="trend__step" onClick={() => step(1)} aria-label="Next headline">
              ›
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
