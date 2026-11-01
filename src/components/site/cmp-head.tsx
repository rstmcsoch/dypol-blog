import { createElement, useState } from "react";
import { getRouteApi, useRouterState } from "@tanstack/react-router";
import { cmpMirrorNodes, headBlock, isCmpPath, mirrorProps } from "@/lib/ads/cmp";
import { useSite } from "./use-site";

const rootRoute = getRouteApi("__root__");

export function useCmpHead(): string {
  const data = rootRoute.useLoaderData() as { cmpHead?: string } | undefined;
  return data?.cmpHead ?? "";
}

/**
 * t161/t164: hydration mirrors for the head block (consent tool's code, then
 * Settings → Custom head code). The server strips
 * these from the HTML and puts the owner's code verbatim first in <head>;
 * on the client they hydrate onto those exact nodes. Decided once from the
 * first URL and never re-rendered, so client navigation never creates or
 * re-runs a script.
 */
export function CmpHeadMirror() {
  const cmp = useCmpHead();
  const custom = useSite().customHead ?? "";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [nodes] = useState(() => {
    const code = headBlock(cmp, custom);
    return code && isCmpPath(pathname) ? cmpMirrorNodes(code) : [];
  });
  return <>{nodes.map((n, i) => createElement(n.tag, { key: `cmp-${i}`, ...mirrorProps(n) }))}</>;
}
