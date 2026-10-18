import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultErrorComponent: AppErrorComponent,
    // Prefetch route data on hover/focus/touch intent, so article taps feel
    // instant instead of waiting ~seconds for an uncached server-function call.
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
  });
}
