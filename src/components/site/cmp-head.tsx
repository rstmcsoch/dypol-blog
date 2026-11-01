import { createElement, useState } from "react";
import { getRouteApi, useRouterState } from "@tanstack/react-router";
import { cmpMirrorNodes, isCmpPath, mirrorProps } from "@/lib/ads/cmp";

const rootRoute = getRouteApi("__root__");

export function useCmpHead(): string {
  const data = rootRoute.useLoaderData() as { cmpHead?: string } | undefined;
  return data?.cmpHead ?? "";
}

/**
 * t161: hydration mirrors for the consent tool's head code. The server strips
 * these from the HTML and puts the owner's code verbatim first in <head>;
 * on the client they hydrate onto those exact nodes. Decided once from the
 * first URL and never re-rendered, so client navigation never creates or
 * re-runs a script.
 */
export function CmpHeadMirror() {
  const code = useCmpHead();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [nodes] = useState(() => (code && isCmpPath(pathname) ? cmpMirrorNodes(code) : []));
  return <>{nodes.map((n, i) => createElement("script", { key: `cmp-${i}`, ...mirrorProps(n) }))}</>;
}
