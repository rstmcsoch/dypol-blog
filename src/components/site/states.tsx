import { Link } from "@tanstack/react-router";
import { site } from "@/content/site";

export function EmptyState() {
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
      <div className="container">
        <p className="kicker">{site.labels.loading}</p>
        <div className="skeleton skeleton--title" />
        <div className="skeleton" />
        <div className="skeleton skeleton--short" />
      </div>
    </div>
  );
}
