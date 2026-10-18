import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { site as fallback } from "@/content/site";
import { useSite } from "./use-site";

export function EmptyState() {
  const site = useSite();
  return (
    <div className="state-panel">
      <p className="state-panel__num">00</p>
      <h2 className="state-panel__title">{site.labels.emptyTitle}</h2>
      <p className="state-panel__body">{site.labels.emptyBody}</p>
      <Link to="/articles" className="btn btn--ghost">
        {site.labels.emptyAction}
      </Link>
    </div>
  );
}

export function NotFoundState() {
  const site = useSite();
  useEffect(() => {
    // t69: log the missed path for the admin 404 report (aggregated, no IP/UA stored).
    try {
      void fetch("/api/not-found", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: window.location.pathname, referrer: document.referrer || "" }),
        keepalive: true,
      }).catch(() => undefined);
    } catch { /* never break the 404 page */ }
  }, []);
  return (
    <div className="page">
      <div className="container">
        <div className="state-panel">
          <p className="kicker">{site.labels.notFoundKicker}</p>
          <h1 className="state-panel__title">{site.labels.notFoundTitle}</h1>
          <p className="state-panel__body">{site.labels.notFoundBody}</p>
          <Link to="/" className="btn">
            {site.labels.backHome}
          </Link>
        </div>
      </div>
    </div>
  );
}

export function PagePending() {
  return (
    <div className="page" aria-busy="true" aria-live="polite">
      <span className="sr-only" role="status">{fallback.labels.loading}…</span>
      <div className="container" aria-hidden="true">
        <div className="skeleton skeleton--title" />
        <div className="skeleton" />
        <div className="skeleton skeleton--short" />
      </div>
    </div>
  );
}

/**
 * Article-shaped skeleton (t56): mirrors the real article layout —
 * kicker/title/lede/meta, hero plate, body column + narrower sidebar —
 * so content swaps in with minimal layout shift. Shown only while the
 * article loader is in flight (client navigation); direct loads are SSR.
 */
export function ArticlePagePending() {
  return (
    <div className="article article-skeleton" aria-busy="true">
      <span className="sr-only" role="status">{fallback.labels.loading}…</span>
      <div className="container" aria-hidden="true">
        <div className="article-top">
          <div className="skeleton skeleton--kicker" />
          <div className="skeleton skeleton--headline" />
          <div className="skeleton skeleton--headline skeleton--headline-2" />
          <div className="skeleton skeleton--lede" />
          <div className="skeleton skeleton--meta" />
        </div>
        <div className="skeleton skeleton--hero" />
        <div className="article-layout">
          <div className="article-body">
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton skeleton--w92" />
            <div className="skeleton" />
            <div className="skeleton skeleton--w84" />
            <div className="skeleton" />
            <div className="skeleton skeleton--short" />
          </div>
          <aside className="article-aside">
            <div className="skeleton skeleton--aside-head" />
            <div className="skeleton-row"><div className="skeleton skeleton--thumb" /><div className="skeleton skeleton--row-title" /></div>
            <div className="skeleton-row"><div className="skeleton skeleton--thumb" /><div className="skeleton skeleton--row-title" /></div>
            <div className="skeleton-row"><div className="skeleton skeleton--thumb" /><div className="skeleton skeleton--row-title" /></div>
            <div className="skeleton skeleton--aside-head" />
            <div className="skeleton-row"><div className="skeleton skeleton--chip" /><div className="skeleton skeleton--chip" /></div>
          </aside>
        </div>
      </div>
    </div>
  );
}
