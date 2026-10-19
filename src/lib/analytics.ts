/**
 * Google Analytics 4 (gtag.js) — single site-wide installation (t95).
 *
 * The measurement ID is a public identifier (it is visible in every page's
 * HTML), so it is kept here as a plain site-config constant rather than an
 * env var / secret. This module is the ONE place the ID lives; the root
 * route renders the loader + init script from it, and the route-change
 * tracker below reuses it. Never add a second gtag snippet elsewhere.
 */
export const GA_MEASUREMENT_ID = "G-T1R0QJ2F0Z";

export const GA_SCRIPT_URL = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;

/**
 * Inline bootstrap, exactly as Google instructs (dataLayer + gtag shim,
 * then a single `config`). That initial `config` sends the first page_view,
 * so the route-change tracker must NOT send another for the landing path.
 */
export const gtagInitScript = [
  "window.dataLayer = window.dataLayer || [];",
  "function gtag(){dataLayer.push(arguments);}",
  "gtag('js', new Date());",
  `gtag('config', '${GA_MEASUREMENT_ID}');`,
].join("\n");

declare global {
  interface Window {
    dataLayer?: Array<unknown>;
    gtag?: (...args: Array<unknown>) => void;
  }
}

/** Parameters for a client-side-navigation page_view. */
export function pageViewParams(input: { path: string; location: string; title: string }) {
  return {
    page_path: input.path,
    page_location: input.location,
    page_title: input.title,
  } as const;
}

/**
 * Decide whether a route observation should emit a page_view.
 *
 * - The first observed path is the SSR landing page: gtag's `config`
 *   already counted it, so it is recorded but not re-sent.
 * - Re-observing the same path (React StrictMode double effects, query
 *   object identity churn with an unchanged path) is not a navigation.
 * - Any later, different path is a client-side navigation and counts.
 *
 * Pure and injectable so it can be unit-tested without a DOM.
 */
export function createPageViewTracker() {
  let lastPath: string | null = null;
  return {
    /** Returns true when this observation should send a page_view. */
    observe(path: string): boolean {
      if (lastPath === path) return false;
      const isFirst = lastPath === null;
      lastPath = path;
      return !isFirst;
    },
    reset() {
      lastPath = null;
    },
  };
}

export type PageViewTracker = ReturnType<typeof createPageViewTracker>;

/** Send a page_view for a client-side navigation. No-op without gtag (SSR, blocked, not yet loaded). */
export function trackPageView(path: string): boolean {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return false;
  window.gtag(
    "event",
    "page_view",
    pageViewParams({ path, location: window.location.href, title: document.title }),
  );
  return true;
}
