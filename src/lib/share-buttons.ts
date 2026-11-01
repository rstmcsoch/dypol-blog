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

export type ShareSettings = { buttons: ShareButton[] };

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

/** Exactly the five buttons the site always had, in the same order. */
export const DEFAULT_SHARE_BUTTONS: ShareButton[] = [b("share-x", "x"), b("share-linkedin", "linkedin"), b("share-facebook", "facebook"), b("share-email", "email"), b("share-copy", "copy")];

export function defaultShareSettings(): ShareSettings {
  return { buttons: DEFAULT_SHARE_BUTTONS.map((x) => ({ ...x })) };
}

/** A custom template must be an absolute http(s) URL with at least one placeholder or a fixed target. */
export function customTemplateError(template: string): string | null {
  const t = template.trim();
  if (!t) return "Enter a link template, e.g. https://example.com/share?u={url}&t={title}";
  if (t.length > 500) return "The link template is too long (500 characters max).";
  if (/[\s<>"'`]/.test(t)) return "The link template cannot contain spaces or quotes.";
  let parsed: URL;
  try {
    parsed = new URL(t.replaceAll("{url}", "x").replaceAll("{title}", "x"));
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
  if (!list) return defaultShareSettings();
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
  return { buttons };
}
