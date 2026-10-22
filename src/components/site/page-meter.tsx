import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { shouldMeterPath } from "@/lib/stats/classify";
import { postJson, readAcquisition } from "./meter";

/** One non-article page view per tab session. Renders nothing. */
export function PageMeter() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => {
    const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
    if (!shouldMeterPath(path)) return;
    const key = `dypol-meter:${path}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* still count */
    }
    postJson("/api/meter", { path, ...readAcquisition() });
  }, [pathname]);
  return null;
}
