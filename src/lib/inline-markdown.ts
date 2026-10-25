/**
 * t106: safe inline markdown -> tiny AST (rendered by components/markdown.tsx).
 * Supports **bold**, __bold__, *italic*, _italic_, ***bold italic***,
 * ~~strike~~, `code`, [label](url "title"), <https://autolinks>, bare
 * https:// and www. URLs, backslash escapes and HTML entities (&times; &#215;
 * &#x2192; …). Raw HTML is never passed through: it stays literal text.
 */
export type InlineNode =
  | { t: "text"; v: string }
  | { t: "strong" | "em" | "del"; c: InlineNode[] }
  | { t: "code"; v: string }
  | { t: "br" }
  | { t: "link"; href: string; title?: string; c: InlineNode[] };

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", times: "×", divide: "÷", plusmn: "±", deg: "°",
  rarr: "→", larr: "←", harr: "↔", uarr: "↑", darr: "↓", rArr: "⇒", lArr: "⇐", hArr: "⇔", asymp: "≈", ne: "≠", le: "≤", ge: "≥",
  hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
  copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", yen: "¥", cent: "¢", inr: "₹", middot: "·", bull: "•",
  frac12: "½", frac14: "¼", frac34: "¾", sup1: "¹", sup2: "²", sup3: "³", micro: "µ", infin: "∞", prime: "′", Prime: "″",
  minus: "−", sect: "§", para: "¶", check: "✓", cross: "✗", star: "★", alpha: "α", beta: "β", gamma: "γ", delta: "δ",
  Delta: "Δ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", Sigma: "Σ", Omega: "Ω", ohm: "Ω", sum: "∑", radic: "√", approx: "≈",
};

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,10});/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return m;
      return String.fromCodePoint(code);
    }
    return NAMED[body] ?? NAMED[body.toLowerCase()] ?? m;
  });
}

/** Only these link targets are ever emitted; anything else (javascript:, data:, …) stays text. */
export function safeHref(raw: string): string | null {
  const href = raw.trim().replace(/^<|>$/g, "");
  if (/^https?:\/\/[^\s]+$/i.test(href)) return href;
  if (/^www\.[^\s]+\.[^\s]+$/i.test(href)) return `https://${href}`;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(href)) return href;
  if (/^\/(?!\/)[^\s]*$/.test(href) || /^#[^\s]*$/.test(href)) return href;
  return null;
}

const ESCAPABLE = "\\`*_{}[]()#+-.!|~<>&";
const isWs = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Trims trailing punctuation (and unbalanced ")") off a bare URL. */
function trimUrl(url: string): string {
  let u = url.replace(/[.,;:!?'"’”*_~]+$/, "");
  while (u.endsWith(")") && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) u = u.slice(0, -1).replace(/[.,;:!?'"’”]+$/, "");
  return u;
}

/** Finds the closing delimiter for an emphasis run starting at `from`. */
function findClose(s: string, delim: string, from: number): number {
  let i = from;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = s.indexOf("`", i + 1);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (s.startsWith(delim, i) && !isWs(s[i - 1]) && i > from) {
      // For single * / _ do not stop inside a ** / __ pair.
      if (delim.length === 1 && s[i + 1] === delim[0]) {
        const nextClose = findClose(s, delim + delim, i + 2);
        if (s[i - 1] !== delim[0] && nextClose !== -1) {
          i = nextClose + 2;
          continue;
        }
      }
      if (delim[0] === "_" && isWord(s[i + delim.length])) {
        i += 1;
        continue;
      }
      return i;
    }
    i += 1;
  }
  return -1;
}

export function parseInline(src: string, depth = 0): InlineNode[] {
  const out: InlineNode[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: decodeEntities(buf) });
    buf = "";
  };
  const s = src;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    // Backslash escapes.
    if (ch === "\\" && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    // Code span.
    if (ch === "`") {
      let ticks = 1;
      while (s[i + ticks] === "`") ticks += 1;
      const fence = "`".repeat(ticks);
      const end = s.indexOf(fence, i + ticks);
      if (end !== -1) {
        flush();
        out.push({ t: "code", v: s.slice(i + ticks, end).replace(/^ (.+) $/, "$1") });
        i = end + ticks;
        continue;
      }
    }
    // Autolink <https://…>.
    if (ch === "<") {
      const m = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(s.slice(i));
      const href = m ? safeHref(m[1]) : null;
      if (m && href) {
        flush();
        out.push({ t: "link", href, c: [{ t: "text", v: m[1].replace(/^mailto:/i, "") }] });
        i += m[0].length;
        continue;
      }
    }
    // [label](url "title")
    if (ch === "[" && depth < 4) {
      let level = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === "\\") {
          j += 1;
          continue;
        }
        if (s[j] === "[") level += 1;
        else if (s[j] === "]" && --level === 0) break;
      }
      if (j < s.length && s[j + 1] === "(") {
        const m = /^\(\s*(<[^>]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+"([^"]*)")?\s*\)/.exec(s.slice(j + 1));
        if (m) {
          const label = s.slice(i + 1, j);
          const href = safeHref(m[1]);
          flush();
          if (href) out.push({ t: "link", href, ...(m[2] ? { title: decodeEntities(m[2]) } : {}), c: parseInline(label, depth + 1) });
          else out.push(...parseInline(label, depth + 1));
          i = j + 1 + m[0].length;
          continue;
        }
      }
    }
    // Bare URL.
    if ((ch === "h" || ch === "H" || ch === "w" || ch === "W") && !isWord(s[i - 1])) {
      const m = /^(?:https?:\/\/|www\.)[^\s<>"]+/i.exec(s.slice(i));
      if (m) {
        const url = trimUrl(m[0]);
        const href = safeHref(url);
        if (href && url.length > 4) {
          flush();
          out.push({ t: "link", href, c: [{ t: "text", v: url }] });
          i += url.length;
          continue;
        }
      }
    }
    // Emphasis / strong / strike.
    if ((ch === "*" || ch === "_" || ch === "~") && depth < 6) {
      let run = 1;
      while (s[i + run] === ch) run += 1;
      const canOpen = !isWs(s[i + run]) && !(ch === "_" && isWord(s[i - 1]));
      if (canOpen) {
        if (ch === "~" && run === 2) {
          const end = findClose(s, "~~", i + 2);
          if (end !== -1) {
            flush();
            out.push({ t: "del", c: parseInline(s.slice(i + 2, end), depth + 1) });
            i = end + 2;
            continue;
          }
        } else if (ch !== "~" && run >= 3) {
          const d = ch.repeat(3);
          const end = findClose(s, d, i + 3);
          if (end !== -1) {
            flush();
            out.push({ t: "strong", c: [{ t: "em", c: parseInline(s.slice(i + 3, end), depth + 1) }] });
            i = end + 3;
            continue;
          }
        }
        if (ch !== "~" && run >= 2) {
          const d = ch.repeat(2);
          const end = findClose(s, d, i + 2);
          if (end !== -1) {
            flush();
            out.push({ t: "strong", c: parseInline(s.slice(i + 2, end), depth + 1) });
            i = end + 2;
            continue;
          }
        }
        if (ch !== "~" && run >= 1) {
          const end = findClose(s, ch, i + 1);
          if (end !== -1) {
            flush();
            out.push({ t: "em", c: parseInline(s.slice(i + 1, end), depth + 1) });
            i = end + 1;
            continue;
          }
        }
      }
      buf += ch.repeat(run);
      i += run;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

/** Plain text of inline markdown (no markers), for alt text / aria labels. */
export function inlinePlain(src: string): string {
  const walk = (nodes: InlineNode[]): string => nodes.map((n) => (n.t === "text" || n.t === "code" ? n.v : n.t === "br" ? " " : walk(n.c))).join("");
  return walk(parseInline(src));
}

/** Host without a leading "www." and without a port, lower-cased. */
export function bareHost(host: string): string {
  return host.toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "");
}

/**
 * t106: is `href` on one of the site's own hosts? Relative, hash and mailto
 * links are never "external". `ownHosts` = the current window host plus the
 * configured canonical origin; www and non-www count as the same site.
 */
export function isExternalHref(href: string, ownHosts: string[]): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  let host: string;
  try {
    host = new URL(href).host;
  } catch {
    return false;
  }
  const own = new Set(ownHosts.filter(Boolean).map(bareHost));
  return !own.has(bareHost(host));
}
