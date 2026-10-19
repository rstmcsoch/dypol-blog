import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import { createPageViewTracker, trackPageView } from "@/lib/analytics";

/**
 * Sends a GA page_view on TanStack Router client-side navigations.
 *
 * The initial (SSR) page_view comes from the `gtag('config', …)` bootstrap
 * in the document head, so the tracker deliberately suppresses the first
 * observed path and any duplicate observation of the same path. Renders
 * nothing and loads nothing — the gtag loader itself lives in <head>.
 */
export function GoogleAnalytics() {
  const path = useRouterState({
    select: (state) => state.location.pathname + state.location.searchStr,
  });
  const trackerRef = useRef<ReturnType<typeof createPageViewTracker> | null>(null);
  if (trackerRef.current === null) trackerRef.current = createPageViewTracker();

  useEffect(() => {
    if (trackerRef.current?.observe(path)) trackPageView(path);
  }, [path]);

  return null;
}
