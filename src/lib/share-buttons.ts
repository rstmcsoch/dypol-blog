import { composeShare, defaultShareConfig, joinShare, normalizeShareConfig, type ShareConfig, type ShareSubject } from "./share-config.ts";

/**
 * t148: configurable article share buttons (Admin → Homepage builder → Article
 * sidebar → Share buttons). Built-in networks have fixed, tested URL templates;
 * custom buttons take an http(s) template with {url} and {title} placeholders.
 * Values are always URL-encoded; nothing but http(s)/mailto ever becomes a link.
 */
export const SHARE_KINDS = [
  "x",
  "linkedin",
  "facebook",
  "email",
  "copy",
  "whatsapp",
  "telegram",
  "reddit",
  "threads",
  "bluesky",
  "pinterest",
  "hackernews",
  "native",
  "custom",
] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

export type ShareButton = {
  id: string;
  kind: ShareKind;
  enabled: boolean;
  /** Empty = the built-in name (Copy link uses Site text → "Copy link"). */
  label: string;
  /** custom only: https://…?u={url}&t={title} */
  template: string;
};

/** t195: buttons (where) + the system-wide share config (what is shared). */
export type ShareSettings = { buttons: ShareButton[] } & ShareConfig;

/** Built-in templates. {url} / {title} are replaced with encoded values. */
export const SHARE_NETWORKS: Record<Exclude<ShareKind, "copy" | "native" | "custom">, { name: string; template: string }> = {
  x: { name: "X", template: "https://x.com/intent/post?url={url}&text={title}" },
  linkedin: { name: "LinkedIn", template: "https://www.linkedin.com/sharing/share-offsite/?url={url}" },
  facebook: { name: "Facebook", template: "https://www.facebook.com/sharer/sharer.php?u={url}" },
  email: { name: "Email", template: "mailto:?subject={title}&body={url}" },
  whatsapp: { name: "WhatsApp", template: "https://wa.me/?text={title}%20{url}" },
  telegram: { name: "Telegram", template: "https://t.me/share/url?url={url}&text={title}" },
  reddit: { name: "Reddit", template: "https://www.reddit.com/submit?url={url}&title={title}" },
  threads: { name: "Threads", template: "https://www.threads.net/intent/post?text={title}%20{url}" },
  bluesky: { name: "Bluesky", template: "https://bsky.app/intent/compose?text={title}%20{url}" },
  pinterest: { name: "Pinterest", template: "https://www.pinterest.com/pin/create/button/?url={url}&description={title}" },
  hackernews: { name: "Hacker News", template: "https://news.ycombinator.com/submitlink?u={url}&t={title}" },
};

export const SHARE_KIND_NAMES: Record<ShareKind, string> = {
  ...Object.fromEntries(Object.entries(SHARE_NETWORKS).map(([k, v]) => [k, v.name])),
  copy: "Copy link",
  native: "Share…",
  custom: "Custom",
} as Record<ShareKind, string>;

const b = (id: string, kind: ShareKind): ShareButton => ({ id, kind, enabled: true, label: "", template: "" });

/** The five buttons the site had before t150 (used to migrate untouched settings). */
export const LEGACY_SHARE_KINDS: ShareKind[] = ["x", "linkedin", "facebook", "email", "copy"];

/** t150: every built-in network is on by default; Share… only shows where the browser supports it. */
export const DEFAULT_SHARE_BUTTONS: ShareButton[] = (
  ["x", "linkedin", "facebook", "whatsapp", "telegram", "reddit", "threads", "bluesky", "pinterest", "hackernews", "email", "copy", "native"] as ShareKind[]
).map((kind) => b(`share-${kind}`, kind));

/** True when stored buttons are the old five-button default, untouched (labels empty or the built-in name). */
export function isLegacyDefault(buttons: ShareButton[]): boolean {
  return (
    buttons.length === LEGACY_SHARE_KINDS.length &&
    buttons.every((x, i) => x.kind === LEGACY_SHARE_KINDS[i] && x.id === `share-${x.kind}` && x.enabled && !x.template && (!x.label || x.label === SHARE_KIND_NAMES[x.kind]))
  );
}

export function defaultShareSettings(): ShareSettings {
  return { buttons: DEFAULT_SHARE_BUTTONS.map((x) => ({ ...x })), ...defaultShareConfig() };
}

/** A custom template must be an absolute http(s) URL with at least one placeholder or a fixed target. */
export function customTemplateError(template: string): string | null {
  const t = template.trim();
  if (!t) return "Enter a link template, e.g. https://example.com/share?u={url}&t={title}";
  if (t.length > 500) return "The link template is too long (500 characters max).";
  if (/[\s<>"'`]/.test(t)) return "The link template cannot contain spaces or quotes.";
  let parsed: URL;
  try {
    parsed = new URL(t.replaceAll("{url}", "x").replaceAll("{title}", "x").replaceAll("{text}", "x"));
  } catch {
    return "The link template must be a full https:// address.";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "Only http:// or https:// links are allowed.";
  if (!/^https?:\/\//i.test(t)) return "The link template must start with https://";
  return null;
}

function fill(template: string, url: string, title: string): string {
  return template.replaceAll("{url}", encodeURIComponent(url)).replaceAll("{title}", encodeURIComponent(title));
}

/** The href for a link-type button, or null (copy/native/invalid custom render as buttons or not at all). */
export function shareHref(button: Pick<ShareButton, "kind" | "template">, url: string, title: string): string | null {
  if (button.kind === "copy" || button.kind === "native") return null;
  if (button.kind === "custom") {
    if (customTemplateError(button.template)) return null;
    const href = fill(button.template.trim(), url, title);
    return /^https?:\/\//i.test(href) ? href : null;
  }
  const net = SHARE_NETWORKS[button.kind];
  return net ? fill(net.template, url, title) : null;
}

export function shareLabel(button: Pick<ShareButton, "kind" | "label">, copyLabel: string): string {
  const own = button.label.trim();
  if (own) return own;
  return button.kind === "copy" ? copyLabel : SHARE_KIND_NAMES[button.kind];
}

/** Tolerant read of stored settings: unknown kinds and bad custom templates are dropped, never thrown. */
export function normalizeShareSettings(raw: unknown): ShareSettings {
  const list = raw && typeof raw === "object" && Array.isArray((raw as ShareSettings).buttons) ? (raw as ShareSettings).buttons : null;
  const config = normalizeShareConfig(raw);
  if (!list) return { ...defaultShareSettings(), ...config };
  const seen = new Set<string>();
  const buttons: ShareButton[] = [];
  for (const item of list.slice(0, 24)) {
    if (!item || typeof item !== "object") continue;
    const kind = (SHARE_KINDS as readonly string[]).includes(item.kind) ? item.kind : null;
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim().slice(0, 40) : null;
    if (!kind || !id || seen.has(id)) continue;
    const template = kind === "custom" && typeof item.template === "string" ? item.template.trim().slice(0, 500) : "";
    if (kind === "custom" && customTemplateError(template)) continue;
    seen.add(id);
    buttons.push({ id, kind, enabled: item.enabled !== false, label: typeof item.label === "string" ? item.label.trim().slice(0, 40) : "", template });
  }
  // t150: settings that still equal the old five-button default move to the new default.
  return isLegacyDefault(buttons) ? { ...defaultShareSettings(), ...config } : { buttons, ...config };
}

export type ShareContext = { canonicalUrl: string; siteName: string; publisher: string };
const e = encodeURIComponent;
/** Title-only fields (email subject, Reddit / Hacker News titles) cannot hold line breaks. */
const oneLine = (text: string) => text.replace(/\s*\n+\s*/g, " ").trim();

/**
 * t195: the href for a link-type button from the system-wide share config.
 * With default settings every built-in network produces exactly the pre-t195
 * URL (text = title, link = canonical URL). Text is converted to each network's
 * formatting (see share-format.ts); links, hashtags and handles stay plain.
 */
export function shareHrefFor(button: Pick<ShareButton, "kind" | "template">, cfg: ShareConfig, subject: ShareSubject, ctx: ShareContext): string | null {
  const kind = button.kind;
  if (kind === "copy" || kind === "native") return null;
  const c = composeShare(cfg, subject, kind, ctx);
  const withExtras = [c.text, ...c.extras].filter(Boolean).join(c.separator);
  const url = c.link;
  if (kind === "custom") {
    if (customTemplateError(button.template)) return null;
    const href = button.template
      .trim()
      .replaceAll("{url}", e(url))
      .replaceAll("{title}", e(subject.title))
      .replaceAll("{text}", e(joinShare({ ...c, includeLink: false })));
    return /^https?:\/\//i.test(href) ? href : null;
  }
  switch (kind) {
    case "x":
      return c.includeLink && !withExtras.includes(url) ? `https://x.com/intent/post?url=${e(url)}&text=${e(withExtras)}` : `https://x.com/intent/post?text=${e(joinShare(c))}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`;
    case "email": {
      const body = [c.includeLink && !c.text.includes(url) ? url : "", ...c.extras].filter(Boolean).join("\n");
      return `mailto:?subject=${e(oneLine(c.text))}&body=${e(body)}`;
    }
    case "whatsapp":
      return `https://wa.me/?text=${e(joinShare(c))}`;
    case "telegram":
      return `https://t.me/share/url?url=${e(url)}&text=${e(withExtras)}`;
    case "reddit":
      return `https://www.reddit.com/submit?url=${e(url)}&title=${e(oneLine(c.text))}`;
    case "threads":
      return `https://www.threads.net/intent/post?text=${e(joinShare(c))}`;
    case "bluesky":
      return `https://bsky.app/intent/compose?text=${e(joinShare(c))}`;
    case "pinterest":
      return `https://www.pinterest.com/pin/create/button/?url=${e(url)}&description=${e(withExtras)}`;
    case "hackernews":
      return `https://news.ycombinator.com/submitlink?u=${e(url)}&t=${e(oneLine(c.text))}`;
    default:
      return null;
  }
}

/** What "Copy link" puts on the clipboard: the link (default) or the whole share text. */
export function shareCopyText(cfg: ShareConfig, subject: ShareSubject, ctx: ShareContext): string {
  const c = composeShare(cfg, subject, "copy", ctx);
  return cfg.link.copyMode === "text" ? joinShare(c) : c.link;
}

/** navigator.share() data. Text is only added when it differs from the title (default: { title, url }). */
export function nativeShareData(cfg: ShareConfig, subject: ShareSubject, ctx: ShareContext): { title: string; url: string; text?: string } {
  const c = composeShare(cfg, subject, "native", ctx);
  const text = [c.text, ...c.extras].filter(Boolean).join(c.separator);
  const data: { title: string; url: string; text?: string } = { title: subject.title, url: c.link };
  if (text && text !== subject.title) data.text = text;
  return data;
}
