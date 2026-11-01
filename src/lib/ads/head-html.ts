/**
 * t148: turn an owner-pasted head snippet (verification meta, CMP script,
 * network loader) into plain element descriptions the server can render in
 * <head>. Only script, meta, link, style and noscript are kept.
 */
export type HeadNode = { tag: "script" | "meta" | "link" | "style" | "noscript"; attrs: Record<string, string | true>; inner: string };

const TAG = /<(script|style|noscript)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<(meta|link)\b([^>]*?)\/?>/gi;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function parseAttrs(src: string): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (const m of src.matchAll(ATTR)) {
    const name = m[1].toLowerCase();
    if (/^on/.test(name)) continue; // inline handlers are never needed in <head>
    out[name] = m[2] ?? m[3] ?? m[4] ?? true;
  }
  return out;
}

export function parseHeadHtml(html: string): HeadNode[] {
  const nodes: HeadNode[] = [];
  const clean = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const m of clean.matchAll(TAG)) {
    if (m[1]) nodes.push({ tag: m[1].toLowerCase() as HeadNode["tag"], attrs: parseAttrs(m[2] ?? ""), inner: m[3] ?? "" });
    else nodes.push({ tag: m[4].toLowerCase() as HeadNode["tag"], attrs: parseAttrs(m[5] ?? ""), inner: "" });
  }
  return nodes;
}

const REACT_NAMES: Record<string, string> = {
  class: "className",
  charset: "charSet",
  crossorigin: "crossOrigin",
  "http-equiv": "httpEquiv",
  referrerpolicy: "referrerPolicy",
  nomodule: "noModule",
  fetchpriority: "fetchPriority",
  hreflang: "hrefLang",
  itemprop: "itemProp",
};

/** Attribute map → React props (booleans stay booleans). */
export function reactProps(attrs: Record<string, string | true>): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    const name = REACT_NAMES[k] ?? k;
    out[name] = v === true ? (k === "async" || k === "defer" || k === "nomodule" ? true : "") : v;
  }
  return out;
}

// ---------- t156: resource hints for the configured ad hosts ----------
const AD_SRC = /<(?:script|iframe|img|source)\b[^>]*?\bsrc\s*=\s*["']?((?:https?:)?\/\/[^"'\s>]+)/gi;
const GOOGLE_AD_CODE = /adsbygoogle|googlesyndication\.com|data-ad-client/i;
/** AdSense loader + its auction/creative hosts; only used when AdSense code is present. */
export const GOOGLE_AD_ORIGINS = ["https://pagead2.googlesyndication.com", "https://googleads.g.doubleclick.net", "https://tpc.googlesyndication.com"];

/** Unique https origins that the given ad code loads scripts/frames/images from (order kept). */
export function adOrigins(htmls: string[], self?: string): string[] {
  const out = new Set<string>();
  let google = false;
  for (const html of htmls) {
    if (!html) continue;
    if (GOOGLE_AD_CODE.test(html)) google = true;
    for (const m of html.matchAll(AD_SRC)) {
      try {
        const u = new URL(m[1].startsWith("//") ? `https:${m[1]}` : m[1]);
        const origin = `https://${u.host}`;
        if (u.host && origin !== self) out.add(origin);
      } catch {
        /* not a URL */
      }
    }
  }
  if (google) for (const o of GOOGLE_AD_ORIGINS) out.add(o);
  return [...out];
}
