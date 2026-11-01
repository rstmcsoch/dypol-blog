import { checkHeadCode, parseHeadHtml, reactProps, type HeadNode } from "./head-html.ts";

/**
 * t161: pages that carry the certified consent tool's head code. The server
 * (start.ts) inserts the code verbatim right after <meta charset>; the root
 * shell renders matching hydration mirrors on the same pages only.
 */
export function isCmpPath(pathname: string): boolean {
  return !/^\/(admin|preview|oauth|api|auth|login|mcp)(\/|$)/.test(pathname);
}

/**
 * Scripts in the block that React would claim while hydrating <head>: every
 * script except `async` + `src` ones (React skips those). One mirror per
 * claimable script keeps React's own head scripts (theme, JSON-LD) matched to
 * their own nodes instead of the consent tool's.
 */
export function cmpMirrorNodes(code: string): HeadNode[] {
  return parseHeadHtml(code).filter((n) => (n.tag === "script" && !(n.attrs.src && n.attrs.async)) || (n.tag === "style" && !n.attrs["data-precedence"]) || n.tag === "noscript");
}

/**
 * t164: everything the server places at the top of <head>: the consent
 * tool's block first (Admin → Ads), then the owner's custom head code
 * (Admin → Settings), cleaned to head-valid tags. Server and hydration
 * mirrors both use this, so they always describe the same nodes.
 */
export function headBlock(cmp: string, custom: string): string {
  return [cmp.trim(), checkHeadCode(custom ?? "").code].filter(Boolean).join("\n");
}

export function mirrorProps(n: HeadNode): Record<string, unknown> {
  // (script, style or noscript; see cmpMirrorNodes)
  const props: Record<string, unknown> = { ...reactProps(n.attrs), "data-cmp-mirror": "", suppressHydrationWarning: true };
  if (n.inner) props.dangerouslySetInnerHTML = { __html: n.inner };
  return props;
}

/**
 * The owner's block with only the whitespace *between* top-level tags
 * removed (script bodies untouched). A whitespace text node in <head> stops
 * React's hydration walk, so the block must sit flush against its neighbours.
 */
export function compactHeadBlock(code: string): string {
  const TOKEN = /<!--[\s\S]*?-->|<(script|style|noscript)\b[\s\S]*?<\/\1\s*>|<[^>]+>/gi;
  let out = "";
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    const gap = code.slice(last, m.index);
    if (gap.trim()) out += gap;
    out += m[0];
    last = (m.index ?? 0) + m[0].length;
  }
  const tail = code.slice(last);
  return out + (tail.trim() ? tail : "");
}
