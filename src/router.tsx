import { createBrowserHistory, createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { trackerHistoryWindow } from "@/lib/tracking/tracker-history";
import { routeTree } from "./routeTree.gen";

/**
 * t191: in the browser, URL updates of a client-side navigation reach `window.history`
 * only after the new page rendered (title set), so head-code analytics record each
 * pageview with the right URL *and* title. See tracker-history.ts.
 */
function trackerFriendlyHistory() {
  if (typeof window === "undefined") return undefined;
  try {
    const gate = trackerHistoryWindow(window);
    const history = createBrowserHistory({ window: gate.window });
    history.subscribe(({ action }) => { if (action.type === "PUSH" || action.type === "REPLACE") gate.hold(); });
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
    router.subscribe("onRendered", () => tracked.gate.release());
    // Fallback when a navigation resolves without a new render (same page, superseded …).
    router.subscribe("onResolved", () => requestAnimationFrame(() => requestAnimationFrame(() => tracked.gate.release())));
  }
  return router;
}
