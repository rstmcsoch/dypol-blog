import type { ErrorComponentProps } from "@tanstack/react-router";
import { site } from "@/content/site";

const FALLBACK_MESSAGE = "An unexpected error occurred. Try reloading the page.";

/**
 * The desk and its draft previews are the only places where the full error text
 * is shown. Everywhere else it stays server-side, because a raw runtime message
 * can name internals: D1 statement errors quote SQL and column names, the media
 * store names the R2 bucket and database id, and WebCrypto/JSON failures quote
 * payload fragments. On a public page that is information exposure through an
 * error message (CWE-209) with real reconnaissance value.
 *
 * Read from `window` rather than a router hook on purpose: this component also
 * renders for errors thrown outside a route match, where route context may be
 * unavailable. No `window` (SSR) means no detail, which is the safe default.
 */
const DESK_PATH = /^\/(admin|preview)(\/|$)/;

function detailAllowed(): boolean {
  return typeof window !== "undefined" && DESK_PATH.test(window.location.pathname);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return FALLBACK_MESSAGE;
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main className="error-screen">
      <div className="state-panel">
        <h1 className="state-panel__title">{site.labels.errorTitle}</h1>
        <p>{detailAllowed() ? errorMessage(error) : FALLBACK_MESSAGE}</p>
        <a className="btn" href="/">
          {site.labels.errorHome}
        </a>
      </div>
    </main>
  );
}
