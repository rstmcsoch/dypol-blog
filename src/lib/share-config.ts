/**
 * t195: system-wide sharing settings (Admin → Settings → Sharing). Controls the
 * text, links, image and link-card meta used whenever an article is shared.
 * Every field has a default that reproduces the pre-t195 behaviour exactly:
 * share text = the article title, link = the canonical URL (no UTM), image =
 * cover → default social image, og/twitter title = the page title.
 * Pure module (no runtime imports from the site config) so it runs in tests,
 * route heads, the browser and the admin live preview alike.
 */
import { NETWORK_DEFAULT_FORMAT, SHARE_FORMATS, escapeValue, formatShareText, formattingProblems, stripFormatting, type ShareFormat } from "./share-format.ts";

export type ShareSeparator = "space" | "newline" | "blank";
export type ShareExtraLink = { label: string; url: string };
export type ShareMessageSettings = {
  /** Main text; supports placeholders and formatting tags. Default "{title}". */
  template: string;
  prefix: string;
  suffix: string;
  /** Without the leading #. */
  hashtags: string[];
  separator: ShareSeparator;
  /** Add the article link where a network accepts text-only posts. */
  includeLink: boolean;
  extraLinks: ShareExtraLink[];
};
export type ShareUtmSettings = { enabled: boolean; source: string; medium: string; campaign: string; content: string };
export type ShareLinkSettings = { utm: ShareUtmSettings; /** Copy link copies the link only, or the full share text + link. */ copyMode: "link" | "text" };
export type Toggle3 = "inherit" | "on" | "off";
export type ShareNetworkOverride = {
  /** Empty = use the main template. */
  template: string;
  includeLink: Toggle3;
  hashtags: Toggle3;
  extraLinks: Toggle3;
  utm: Toggle3;
  /** Empty = the UTM source setting. */
  utmSource: string;
  format: "inherit" | ShareFormat;
};
export type ShareImageSource = "cover" | "default" | "branded";
export type LogoPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
export type ShareImageSettings = {
  source: ShareImageSource;
  /** Branded image: the site logo, or a separately uploaded share logo. */
  logo: "site" | "custom";
  logoMediaId: string | null;
  position: LogoPosition;
  /** Logo width as a % of the 1200 px image width. */
  size: number;
  /** Distance from the edges in px (of 1200×630). */
  margin: number;
  opacity: number;
};
export type ShareMetaSettings = {
  /** Empty = the page title ("Title | Site"). */
  titleTemplate: string;
  /** Empty = the SEO description / excerpt. */
  descriptionTemplate: string;
  /** Empty = Site name. */
  siteName: string;
  /** X/Twitter @handle for twitter:site; empty = none. */
  twitterSite: string;
  twitterCard: "auto" | "summary" | "summary_large_image";
  imageAlt: boolean;
  articleTimes: boolean;
  section: boolean;
};
export type ShareConfig = {
  message: ShareMessageSettings;
  link: ShareLinkSettings;
  networks: Record<string, ShareNetworkOverride>;
  image: ShareImageSettings;
  meta: ShareMetaSettings;
};

export const SHARE_PLACEHOLDERS = [
  { key: "title", help: "Article title" },
  { key: "seo_title", help: "SEO title (or the title)" },
  { key: "excerpt", help: "Article summary" },
  { key: "description", help: "SEO description (or the summary)" },
  { key: "url", help: "Share link (with UTM when on)" },
  { key: "author", help: "Byline author (or the publisher)" },
  { key: "category", help: "Primary topic" },
  { key: "site", help: "Site name" },
] as const;
const PLACEHOLDER_KEYS = new Set<string>(SHARE_PLACEHOLDERS.map((p) => p.key));

/** Networks whose share URL has no separate text field for the link (link is appended to the text). */
export const TEXT_ONLY_NETWORKS = new Set(["whatsapp", "threads", "bluesky"]);
/** Networks whose share URL always carries the link. */
export const LINK_REQUIRED_NETWORKS = new Set(["linkedin", "facebook", "telegram", "reddit", "pinterest", "hackernews"]);
/** Networks that ignore any text (only the URL is passed; the card comes from og: meta). */
export const URL_ONLY_NETWORKS = new Set(["linkedin", "facebook"]);

export function defaultShareConfig(): ShareConfig {
  return {
    message: { template: "{title}", prefix: "", suffix: "", hashtags: [], separator: "space", includeLink: true, extraLinks: [] },
    link: { utm: { enabled: false, source: "{network}", medium: "social", campaign: "share", content: "" }, copyMode: "link" },
    networks: {},
    image: { source: "cover", logo: "site", logoMediaId: null, position: "bottom-right", size: 18, margin: 32, opacity: 100 },
    meta: { titleTemplate: "", descriptionTemplate: "", siteName: "", twitterSite: "", twitterCard: "auto", imageAlt: true, articleTimes: true, section: true },
  };
}

export function defaultNetworkOverride(): ShareNetworkOverride {
  return { template: "", includeLink: "inherit", hashtags: "inherit", extraLinks: "inherit", utm: "inherit", utmSource: "", format: "inherit" };
}

// ---- tolerant normalization (stored JSON → full config; never throws) ----

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, fallback: string, max: number) => (typeof v === "string" ? v.slice(0, max) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback);
const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback);
const TOGGLES = ["inherit", "on", "off"] as const;

export function cleanHashtag(tag: string): string {
  return tag.trim().replace(/^#+/, "").replace(/[^\p{L}\p{M}\p{N}_]/gu, "").slice(0, 40);
}
/** "#ai, tech news" → ["ai", "technews"] */
export function parseHashtags(input: string): string[] {
  return input.split(/[\s,]+/).map(cleanHashtag).filter(Boolean).slice(0, 10);
}
/** The hashtags exactly as typed (only the leading # and spaces removed), so problems can be shown instead of silently fixed. */
export function splitHashtags(input: string): string[] {
  return input.split(/[\s,]+/).map((t) => t.trim().replace(/^#+/, "").slice(0, 40)).filter(Boolean);
}
export const MAX_HASHTAGS = 10;
/** Why a typed hashtag would not work as one, or null when it is fine. */
export function hashtagProblem(tag: string): string | null {
  if (/[^\p{L}\p{M}\p{N}_]/u.test(tag)) {
    const clean = cleanHashtag(tag);
    return `Hashtag "#${tag}": only letters, numbers and _ work in hashtags${clean ? ` (it would have to be #${clean})` : ""}.`;
  }
  return null;
}

export function normalizeShareConfig(raw: unknown): ShareConfig {
  const d = defaultShareConfig();
  const r = obj(raw);
  const m = obj(r.message);
  const l = obj(r.link);
  const u = obj(l.utm);
  const im = obj(r.image);
  const me = obj(r.meta);
  const networks: Record<string, ShareNetworkOverride> = {};
  for (const [key, value] of Object.entries(obj(r.networks)).slice(0, 30)) {
    if (!/^[a-z]{1,20}$/.test(key)) continue;
    const o = obj(value);
    const n: ShareNetworkOverride = {
      template: str(o.template, "", 1000),
      includeLink: pick(o.includeLink, TOGGLES, "inherit"),
      hashtags: pick(o.hashtags, TOGGLES, "inherit"),
      extraLinks: pick(o.extraLinks, TOGGLES, "inherit"),
      utm: pick(o.utm, TOGGLES, "inherit"),
      utmSource: str(o.utmSource, "", 60),
      format: pick(o.format, ["inherit", ...SHARE_FORMATS] as const, "inherit"),
    };
    if (!isDefaultOverride(n)) networks[key] = n;
  }
  return {
    message: {
      template: str(m.template, d.message.template, 1000),
      prefix: str(m.prefix, "", 300),
      suffix: str(m.suffix, "", 300),
      // t195: typed hashtags are kept as typed (minus # and spaces); invalid ones are reported by shareConfigProblems, never silently rewritten.
      hashtags: Array.isArray(m.hashtags) ? m.hashtags.filter((t): t is string => typeof t === "string").map((t) => t.trim().replace(/^#+/, "").slice(0, 40)).filter(Boolean).slice(0, 20) : [],
      separator: pick(m.separator, ["space", "newline", "blank"] as const, "space"),
      includeLink: bool(m.includeLink, true),
      extraLinks: Array.isArray(m.extraLinks)
        ? m.extraLinks.slice(0, 5).map((x) => ({ label: str(obj(x).label, "", 60), url: str(obj(x).url, "", 500).trim() }))
        : [],
    },
    link: {
      utm: {
        enabled: bool(u.enabled, false),
        source: str(u.source, d.link.utm.source, 60),
        medium: str(u.medium, d.link.utm.medium, 60),
        campaign: str(u.campaign, d.link.utm.campaign, 100),
        content: str(u.content, "", 100),
      },
      copyMode: pick(l.copyMode, ["link", "text"] as const, "link"),
    },
    networks,
    image: {
      source: pick(im.source, ["cover", "default", "branded"] as const, "cover"),
      logo: pick(im.logo, ["site", "custom"] as const, "site"),
      logoMediaId: typeof im.logoMediaId === "string" && im.logoMediaId.trim() ? im.logoMediaId.trim().slice(0, 80) : null,
      position: pick(im.position, ["top-left", "top-right", "bottom-left", "bottom-right", "center"] as const, d.image.position),
      size: num(im.size, d.image.size, 5, 50),
      margin: num(im.margin, d.image.margin, 0, 120),
      opacity: num(im.opacity, d.image.opacity, 10, 100),
    },
    meta: {
      titleTemplate: str(me.titleTemplate, "", 300),
      descriptionTemplate: str(me.descriptionTemplate, "", 500),
      siteName: str(me.siteName, "", 80),
      twitterSite: str(me.twitterSite, "", 16).trim(),
      twitterCard: pick(me.twitterCard, ["auto", "summary", "summary_large_image"] as const, "auto"),
      imageAlt: bool(me.imageAlt, true),
      articleTimes: bool(me.articleTimes, true),
      section: bool(me.section, true),
    },
  };
}

export function isDefaultOverride(o: ShareNetworkOverride): boolean {
  const d = defaultNetworkOverride();
  return (Object.keys(d) as (keyof ShareNetworkOverride)[]).every((k) => o[k] === d[k]);
}

// ---- validation (admin save / MCP): human-readable, path-tagged ----

export type ShareProblem = { path: string; message: string };

export function unknownPlaceholders(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(/\{([a-z_]+)\}/gi)) if (!PLACEHOLDER_KEYS.has(m[1].toLowerCase())) out.add(m[0]);
  return [...out];
}

function templateProblems(path: string, template: string, label: string): ShareProblem[] {
  const list: ShareProblem[] = [];
  const unknown = unknownPlaceholders(template);
  if (unknown.length) list.push({ path, message: `${label}: unknown placeholder ${unknown.join(", ")}. Use ${SHARE_PLACEHOLDERS.map((p) => `{${p.key}}`).join(" ")}.` });
  for (const p of formattingProblems(template)) list.push({ path, message: `${label}: ${p}` });
  return list;
}

export function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value) || /[\s<>"'`]/.test(value)) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function shareConfigProblems(cfg: ShareConfig): ShareProblem[] {
  const list: ShareProblem[] = [];
  if (!cfg.message.template.trim()) list.push({ path: "message.template", message: "Share text: enter a template, e.g. {title}." });
  list.push(...templateProblems("message.template", cfg.message.template, "Share text"));
  list.push(...templateProblems("message.prefix", cfg.message.prefix, "Text before"));
  list.push(...templateProblems("message.suffix", cfg.message.suffix, "Text after"));
  for (const t of cfg.message.hashtags) {
    const p = hashtagProblem(t);
    if (p) list.push({ path: "message.hashtags", message: p });
  }
  if (cfg.message.hashtags.length > MAX_HASHTAGS) list.push({ path: "message.hashtags", message: `Hashtags: up to ${MAX_HASHTAGS} (you have ${cfg.message.hashtags.length}).` });
  cfg.message.extraLinks.forEach((x, i) => {
    list.push(...templateProblems(`message.extraLinks.${i}.label`, x.label, `Extra link ${i + 1} label`));
    if (!isHttpUrl(x.url)) list.push({ path: `message.extraLinks.${i}.url`, message: `Extra link ${i + 1}: enter a full https:// address.` });
  });
  for (const [key, o] of Object.entries(cfg.networks)) list.push(...templateProblems(`networks.${key}.template`, o.template, `${key} text`));
  const u = cfg.link.utm;
  if (u.enabled) {
    if (!u.source.trim()) list.push({ path: "link.utm.source", message: "UTM source cannot be empty while UTM tags are on." });
    if (!u.medium.trim()) list.push({ path: "link.utm.medium", message: "UTM medium cannot be empty while UTM tags are on." });
    for (const [k, v] of Object.entries(u)) {
      if (typeof v === "string" && /[<>"'`]/.test(v)) list.push({ path: `link.utm.${k}`, message: `UTM ${k} cannot contain quotes or angle brackets.` });
    }
  }
  if (cfg.meta.twitterSite && !/^@?[A-Za-z0-9_]{1,15}$/.test(cfg.meta.twitterSite)) list.push({ path: "meta.twitterSite", message: "X handle: letters, numbers and _ only (up to 15), e.g. @dypol." });
  list.push(...templateProblems("meta.titleTemplate", cfg.meta.titleTemplate, "Link title"));
  list.push(...templateProblems("meta.descriptionTemplate", cfg.meta.descriptionTemplate, "Link description"));
  if (cfg.image.source === "branded" && cfg.image.logo === "custom" && !cfg.image.logoMediaId) list.push({ path: "image.logoMediaId", message: "Branded image: choose or upload a logo." });
  return list;
}

// ---- rendering ----

/** What a share is about (everything the placeholders can show). */
export type ShareSubject = {
  title: string;
  seoTitle?: string | null;
  excerpt?: string | null;
  seoDescription?: string | null;
  author?: string | null;
  category?: string | null;
  slug: string;
  /** Public path, e.g. /articles/foo or /special/bar. */
  path: string;
};

export type ShareVars = Record<string, string>;

export function shareVars(subject: ShareSubject, siteName: string, publisher: string, url: string): ShareVars {
  return {
    title: subject.title,
    seo_title: subject.seoTitle?.trim() || subject.title,
    excerpt: subject.excerpt?.trim() ?? "",
    description: subject.seoDescription?.trim() || subject.excerpt?.trim() || "",
    url,
    author: subject.author?.trim() || publisher,
    category: subject.category?.trim() ?? "",
    site: siteName,
  };
}

/** Replace {placeholders} (values escaped so they are never read as formatting tags). */
export function fillTemplate(template: string, vars: ShareVars): string {
  return template.replace(/\{([a-z_]+)\}/gi, (whole, key: string) => {
    const k = key.toLowerCase();
    return k in vars ? escapeValue(vars[k]) : whole;
  });
}

export function overrideFor(cfg: ShareConfig, network: string): ShareNetworkOverride {
  return cfg.networks[network] ?? defaultNetworkOverride();
}
const on = (t: Toggle3, base: boolean) => (t === "inherit" ? base : t === "on");

export function formatFor(cfg: ShareConfig, network: string): ShareFormat {
  const o = overrideFor(cfg, network);
  return o.format !== "inherit" ? o.format : (NETWORK_DEFAULT_FORMAT[network] ?? "plain");
}

export function separatorText(sep: ShareSeparator): string {
  return sep === "newline" ? "\n" : sep === "blank" ? "\n\n" : " ";
}

/** The share link for one network: canonical URL, plus UTM tags when on. og:url/canonical never get UTM. */
export function shareLinkFor(cfg: ShareConfig, canonicalUrl: string, network: string, subject?: Pick<ShareSubject, "slug">): string {
  const o = overrideFor(cfg, network);
  if (!on(o.utm, cfg.link.utm.enabled)) return canonicalUrl;
  const fill = (v: string) => v.replaceAll("{network}", network).replaceAll("{slug}", subject?.slug ?? "").trim();
  try {
    const url = new URL(canonicalUrl);
    const u = cfg.link.utm;
    const params: [string, string][] = [
      ["utm_source", fill(o.utmSource.trim() || u.source)],
      ["utm_medium", fill(u.medium)],
      ["utm_campaign", fill(u.campaign)],
      ["utm_content", fill(u.content)],
    ];
    for (const [k, v] of params) if (v) url.searchParams.set(k, v);
    return url.toString();
  } catch {
    return canonicalUrl;
  }
}

export type ComposedShare = {
  /** Formatted text without the link (network markup / Unicode applied). */
  text: string;
  /** Extra links (already formatted lines) for networks that put them elsewhere (email body). */
  extras: string[];
  link: string;
  includeLink: boolean;
  separator: string;
  format: ShareFormat;
};

/** Build the share text for one network. Defaults: text = the title, link = canonical URL. */
export function composeShare(
  cfg: ShareConfig,
  subject: ShareSubject,
  network: string,
  ctx: { canonicalUrl: string; siteName: string; publisher: string },
): ComposedShare {
  const o = overrideFor(cfg, network);
  const link = shareLinkFor(cfg, ctx.canonicalUrl, network, subject);
  const vars = shareVars(subject, ctx.siteName, ctx.publisher, link);
  const format = formatFor(cfg, network);
  const fmt = (t: string) => formatShareText(fillTemplate(t, vars), format).replace(/[ \t]+$/gm, "").trim();
  const template = o.template.trim() ? o.template : cfg.message.template;
  const sep = separatorText(cfg.message.separator);
  const tags = on(o.hashtags, true) ? cfg.message.hashtags.map(cleanHashtag).filter(Boolean).slice(0, MAX_HASHTAGS).map((t) => `#${t}`).join(" ") : "";
  const extras = on(o.extraLinks, true)
    ? cfg.message.extraLinks.filter((x) => isHttpUrl(x.url)).map((x) => (x.label.trim() ? `${stripFormatting(x.label.trim())}: ${x.url}` : x.url))
    : [];
  const parts = [fmt(cfg.message.prefix), fmt(template), fmt(cfg.message.suffix), tags].filter(Boolean);
  const includeLink = LINK_REQUIRED_NETWORKS.has(network) || on(o.includeLink, cfg.message.includeLink);
  return { text: parts.join(sep), extras, link, includeLink, separator: sep, format };
}

/** Text + extra links + link, joined (text-only networks, copy "text" mode, previews). Skips a link already in the text. */
export function joinShare(c: ComposedShare, withExtras = true): string {
  const parts = [c.text, ...(withExtras ? c.extras : [])].filter(Boolean);
  if (c.includeLink && !c.text.includes(c.link)) parts.push(c.link);
  return parts.join(c.separator);
}

// ---- link-card meta ----

/** og/twitter title: the template (tags stripped) or the built-in page title. */
export function shareMetaTitle(cfg: ShareConfig, builtIn: string, vars: ShareVars): string {
  if (!cfg.meta.titleTemplate.trim()) return builtIn;
  const t = stripFormatting(fillTemplate(cfg.meta.titleTemplate, vars)).replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 200) : builtIn;
}
/** og/twitter description: the template (tags stripped, ≤ 300 chars) or the built-in description. */
export function shareMetaDescription(cfg: ShareConfig, builtIn: string, vars: ShareVars): string {
  if (!cfg.meta.descriptionTemplate.trim()) return builtIn;
  const t = stripFormatting(fillTemplate(cfg.meta.descriptionTemplate, vars)).replace(/\s+/g, " ").trim();
  if (!t) return builtIn;
  if (t.length <= 300) return t;
  const cut = t.slice(0, 297);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 150 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}
export function twitterHandle(cfg: ShareConfig): string | null {
  const h = cfg.meta.twitterSite.trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(h) ? `@${h}` : null;
}

// ---- branded image ----

export function brandLogoId(cfg: ShareConfig, siteLogoMediaId: string | null | undefined): string | null {
  return cfg.image.logo === "custom" ? cfg.image.logoMediaId : (siteLogoMediaId ?? null);
}

/** FNV-1a 32-bit, hex. Stable across server, browser and tests. */
export function hash32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Version token for a branded image: changes whenever the base image, logo or placement changes. */
export function brandedImageVersion(input: { baseMediaId: string; baseVersion?: string | null; logoMediaId: string; image: ShareImageSettings }): string {
  const { position, size, margin, opacity } = input.image;
  return hash32([input.baseMediaId, input.baseVersion ?? "", input.logoMediaId, position, size, margin, opacity, "v1"].join("|"));
}

/** Pixel placement of the logo on the 1200×630 canvas. */
export function logoPlacement(image: ShareImageSettings, logo: { width: number; height: number }, canvas = { width: 1200, height: 630 }) {
  const width = Math.max(16, Math.round((canvas.width * image.size) / 100));
  const ratio = logo.width > 0 && logo.height > 0 ? logo.height / logo.width : 1;
  let height = Math.round(width * ratio);
  let w = width;
  const maxH = canvas.height - image.margin * 2;
  if (height > maxH) {
    w = Math.max(16, Math.round(w * (maxH / height)));
    height = maxH;
  }
  const m = image.margin;
  const left = image.position.endsWith("left") ? m : image.position.endsWith("right") ? canvas.width - w - m : Math.round((canvas.width - w) / 2);
  const top = image.position.startsWith("top") ? m : image.position.startsWith("bottom") ? canvas.height - height - m : Math.round((canvas.height - height) / 2);
  return { width: w, height, left, top, opacity: image.opacity / 100 };
}

export { stripFormatting };
