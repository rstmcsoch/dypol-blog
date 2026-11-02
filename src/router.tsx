import { createBrowserHistory, createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { trackerHistoryWindow } from "@/lib/tracking/tracker-history";
import { routeTree } from "./routeTree.gen";

/**
 * t191: in the browser, URL updates of a client-side navigation reach `window.history`
 * only after the new page rendered (title set), so head-code analytics record each
 * pageview with the right URL *and* title. See tracker-history.ts.
 * Moving between the public site and /admin is always a full page load.
 */
/** The admin desk and its draft previews: no analytics may see these URLs. */
export const isAdminPath = (pathname: string) => /^\/(admin|preview)(\/|$)/.test(pathname);

function trackerFriendlyHistory() {
  if (typeof window === "undefined") return undefined;
  try {
    const gate = trackerHistoryWindow(window);
    const adminDocument = isAdminPath(window.location.pathname);
    const history = createBrowserHistory({ window: gate.window });
    // Crossing between the public site and /admin is always a full page load, decided before the
    // router renders anything: analytics running on public pages never live in the admin document
    // (so they never see an /admin URL or title), and the admin document never starts public-page
    // scripts. Public pages opened from the admin get a fresh document with their head code.
    const pathOf = (href: string) => new URL(href, window.location.origin).pathname;
    const leave = (href: string, replace: boolean) => {
      gate.abandon();
      if (replace) window.location.replace(href);
      else window.location.assign(href);
    };
    const { push, replace } = history;
    history.push = (path, state, navigateOpts) => {
      if (isAdminPath(pathOf(path)) !== adminDocument) return leave(path, false);
      push(path, state, navigateOpts);
    };
    history.replace = (path, state, navigateOpts) => {
      // A redirect of a navigation that never reached the address bar (e.g. /login → /admin) is a new entry.
      if (isAdminPath(pathOf(path)) !== adminDocument) return leave(path, gate.pending() === 0);
      replace(path, state, navigateOpts);
    };
    history.subscribe(({ action }) => {
      if (action.type === "PUSH" || action.type === "REPLACE") gate.hold();
      // Back/forward onto the other side within one document (only possible for entries the router
      // did not create, since crossings are full loads): load it as its own document.
      else if (isAdminPath(history.location.pathname) !== adminDocument) { gate.abandon(); window.location.reload(); }
    });
    return { history, gate };
  } catch {
    return undefined;
  }
}

export function getRouter() {
  const tracked = trackerFriendlyHistory();
  const router = createRouter({
    routeTree,
    defaultErrorComponent: AppErrorComponent,
    // Prefetch route data on hover/focus/touch intent, so article taps feel
    // instant instead of waiting ~seconds for an uncached server-function call.
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    ...(tracked ? { history: tracked.history } : {}),
  });
  if (tracked) {
    router.subscribe("onRendered", () => { tracked.gate.release(); tracked.gate.rendered(); });
    // Fallback when a navigation resolves without a new render (same page, superseded …).
    router.subscribe("onResolved", () => requestAnimationFrame(() => requestAnimationFrame(() => tracked.gate.release())));
  }
  return router;
}
