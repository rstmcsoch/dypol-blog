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

// ---------- t164: Settings → Custom head code ----------
/** Tags allowed in the custom head code (no <base>: it would retarget every link). */
export const HEAD_TAGS = ["meta", "link", "script", "style", "noscript"] as const;
const HEAD_TOKEN = /<!--[\s\S]*?-->|<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>|<(meta|link)\b[^>]*>|<\/?[a-z!][^>]*>/gi;

export type HeadCodeCheck = {
  /** The kept tags, verbatim, one per line. */
  code: string;
  /** One line per kept tag, for the admin preview. */
  tags: { tag: string; summary: string }[];
  /** Tags or text that were removed (not allowed in <head>). */
  dropped: string[];
};

function summarize(tag: string, attrs: Record<string, string | true>, inner: string): string {
  const a = (k: string) => (typeof attrs[k] === "string" ? (attrs[k] as string) : "");
  if (tag === "meta") return [a("name") || a("property") || a("http-equiv") || (attrs.charset ? "charset" : ""), a("content")].filter(Boolean).join(" = ").slice(0, 140);
  if (tag === "link") return [a("rel"), a("href")].filter(Boolean).join(" → ").slice(0, 140);
  if (tag === "script") {
    const flags = ["async", "defer"].filter((k) => attrs[k]).join(", ");
    return (a("src") ? `src ${a("src")}` : `inline, ${inner.trim().length} characters`) + (flags ? ` (${flags})` : "") + (a("type") ? ` type ${a("type")}` : "");
  }
  return `${inner.trim().length} characters`;
}

/**
 * Keep only head-valid tags (meta, link, script, style, noscript), verbatim.
 * Comments, a pasted </head>, <body>, <base>, <title> and any other markup
 * or loose text are removed and listed in `dropped`.
 */
export function checkHeadCode(input: string): HeadCodeCheck {
  const kept: string[] = [];
  const tags: HeadCodeCheck["tags"] = [];
  const dropped: string[] = [];
  let last = 0;
  const loose = (text: string) => {
    const t = text.trim();
    if (t) dropped.push(t.length > 60 ? `${t.slice(0, 57)}…` : t);
  };
  for (const m of input.matchAll(HEAD_TOKEN)) {
    loose(input.slice(last, m.index));
    last = (m.index ?? 0) + m[0].length;
    if (m[0].startsWith("<!--")) continue;
    const tag = (m[1] ?? m[2] ?? "").toLowerCase();
    if (!tag) {
      dropped.push(m[0].length > 60 ? `${m[0].slice(0, 57)}…` : m[0]);
      continue;
    }
    const open = m[0].match(/^<[a-z]+\b([^>]*)>/i)?.[1] ?? "";
    const inner = m[1] ? m[0].slice(m[0].indexOf(">") + 1, m[0].toLowerCase().lastIndexOf("</")) : "";
    // In <head>, <noscript> may only hold link/meta/style (GTM's <iframe> fallback belongs in <body>).
    if (tag === "noscript" && /<(?!\/?(?:link|meta|style)\b)[a-z/]/i.test(inner)) {
      dropped.push("<noscript> with body content (e.g. GTM's iframe) — that part goes in <body>, not <head>");
      continue;
    }
    kept.push(m[0]);
    tags.push({ tag, summary: summarize(tag, parseAttrs(open.replace(/\/\s*$/, "")), inner) });
  }
  loose(input.slice(last));
  return { code: kept.join("\n"), tags, dropped };
}
