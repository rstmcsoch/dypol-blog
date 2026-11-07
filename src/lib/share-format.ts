/**
 * t196/t197: formatting tags in share text templates. The admin writes our own
 * tags (<b>, <i>, <c> …); at share time they are converted to the formatting each
 * destination natively understands, or removed where it has none:
 *  - "whatsapp": WhatsApp's markup (*bold* _italic_ ~strike~ `code` / ```block```),
 *    from WhatsApp Help Center "How to format your messages". No underline.
 *  - "telegram": the Telegram apps' typed shortcuts (**bold** __italic__ ~~strike~~
 *    `mono`, listed in Telegram's own app strings). Opt-in only: Telegram's share URL
 *    docs (core.telegram.org/widgets/share) describe {text} as a plain comment and say
 *    nothing about formatting it, so whether a prefilled shortcut is converted is not
 *    guaranteed. Telegram's default is plain text.
 *  - "markdown": Discord markdown (**bold** *italic* __underline__ ~~strike~~ `code`).
 *  - "slack": Slack mrkdwn (*bold* _italic_ ~strike~ `code`; no underline).
 *  - "plain": tags removed (every share URL whose post box has no text formatting:
 *    X, Facebook, LinkedIn, Threads, Bluesky, Pinterest, Reddit titles, Hacker News,
 *    email, Copy link, the device Share sheet).
 *  - "unicode": optional look-alike letters from the Mathematical Alphanumeric
 *    block (𝗯𝗼𝗹𝗱 𝘪𝘵𝘢𝘭𝘪𝘤 𝚖𝚘𝚗𝚘). This is NOT real formatting: screen readers may
 *    spell them out and search/hashtags do not match them, so it is never a default.
 * URLs, #hashtags and @handles inside styled text are never restyled or wrapped, so
 * links keep working and hashtags stay searchable. Placeholder values are escaped
 * before parsing, so a "<b>" inside an article title is shown literally.
 */
export type ShareFormat = "plain" | "whatsapp" | "telegram" | "markdown" | "slack" | "unicode";
export const SHARE_FORMATS: readonly ShareFormat[] = ["plain", "whatsapp", "telegram", "markdown", "slack", "unicode"];

/** Admin-facing names for each output format. */
export const SHARE_FORMAT_NAMES: Record<ShareFormat, string> = {
  plain: "Plain text (tags removed)",
  whatsapp: "WhatsApp formatting (*bold* _italic_)",
  telegram: "Telegram typed shortcuts (**bold** __italic__) — not guaranteed",
  markdown: "Discord markdown (**bold** *italic*)",
  slack: "Slack mrkdwn (*bold* _italic_)",
  unicode: "Unicode look-alike letters (not real formatting)",
};

/** What each format can show; anything else falls back to plain text for that style. */
export const SHARE_FORMAT_SUPPORT: Record<ShareFormat, string> = {
  plain: "No formatting: tags are removed, the words stay.",
  whatsapp: "Bold, italic, strikethrough, code. No underline (shown as plain text).",
  telegram: "Inserts Telegram's typed shortcuts (**bold** __italic__ ~~strike~~ `code`). Telegram's share link documents plain text only, so the markers may show as typed. No underline (plain).",
  markdown: "Bold, italic, underline, strikethrough, code.",
  slack: "Bold, italic, strikethrough, code. No underline (plain).",
  unicode: "Look-alike letters only (Latin A–Z, 0–9). Not real formatting: screen readers may read them oddly and search does not match them.",
};

/**
 * Default format per built-in network (researched, t197). Only WhatsApp documents
 * formatting that a prefilled share text carries (its markup is plain characters
 * that WhatsApp renders); Telegram's share URL documents a plain comment; the other share
 * endpoints insert plain text, or ignore text entirely (Facebook, LinkedIn: the
 * link card from og: tags is all that shows).
 */
export const NETWORK_DEFAULT_FORMAT: Record<string, ShareFormat> = {
  whatsapp: "whatsapp",
  telegram: "plain",
  x: "plain",
  facebook: "plain",
  linkedin: "plain",
  threads: "plain",
  bluesky: "plain",
  pinterest: "plain",
  reddit: "plain",
  hackernews: "plain",
  email: "plain",
  copy: "plain",
  native: "plain",
  custom: "plain",
};

/** What each built-in destination does with the share text (shown in the admin). */
export const NETWORK_LIMITS: Record<string, string> = {
  whatsapp: "Text + link in one message. Native formatting.",
  telegram: "Link plus a plain comment the user can edit before sending (Telegram's share link documents no formatting).",
  x: "Plain text; 280 characters including the link (links count as 23).",
  facebook: "Ignores text: only the link is passed; the post shows the link card (title, description, image below).",
  linkedin: "Ignores text: only the link is passed; the post shows the link card.",
  threads: "Plain text with the link; 500 characters.",
  bluesky: "Plain text with the link; 300 characters.",
  pinterest: "Plain text description; the pin image is the share image.",
  reddit: "Link post: the text is the title (plain, 300 characters).",
  hackernews: "Link post: the text is the title (plain, 80 characters).",
  email: "Text is the subject (plain); link and extra links go in the body.",
  copy: "Copies the link, or the plain text + link (Link options).",
  native: "The device share sheet: plain text + link; each app decides what it keeps.",
  custom: "Your own link template; choose the format its destination understands.",
};

export type FormatTag = { tag: string; label: string; example: string; wraps: boolean };
/** The tags the admin can use (legend + quick-insert buttons). */
export const FORMAT_TAGS: FormatTag[] = [
  { tag: "b", label: "Bold", example: "<b>bold</b>", wraps: true },
  { tag: "i", label: "Italic", example: "<i>italic</i>", wraps: true },
  { tag: "bi", label: "Bold italic", example: "<bi>bold italic</bi>", wraps: true },
  { tag: "u", label: "Underline", example: "<u>underline</u>", wraps: true },
  { tag: "s", label: "Strikethrough", example: "<s>struck</s>", wraps: true },
  { tag: "c", label: "Code / monospace", example: "<c>code</c>", wraps: true },
  { tag: "q", label: "Quote (adds “ ” marks)", example: "<q>quoted</q>", wraps: true },
  { tag: "br", label: "Line break", example: "<br>", wraps: false },
];

type Style = { b: boolean; i: boolean; c: boolean; u: boolean; s: boolean };
type Segment = { text: string; style: Style };

const TAG_RE = /<(\/?)(bi|b|i|c|u|s|q)>|<br\s*\/?>/gi;
/** Placeholder values are written with this in place of "<" (see escapeValue). */
const LT = "\uE000";

export function escapeValue(value: string): string {
  return value.replaceAll("<", LT);
}
function unescape(text: string): string {
  return text.replaceAll(LT, "<");
}

/** Split tagged text into styled segments. Unclosed tags run to the end; stray closers are ignored. */
export function parseFormatted(input: string): Segment[] {
  const out: Segment[] = [];
  const counts: Record<string, number> = { b: 0, i: 0, c: 0, u: 0, s: 0 };
  const style = (): Style => ({ b: counts.b > 0, i: counts.i > 0, c: counts.c > 0, u: counts.u > 0, s: counts.s > 0 });
  const push = (text: string) => {
    if (!text) return;
    const st = style();
    const last = out[out.length - 1];
    if (last && sameStyle(last.style, st)) last.text += text;
    else out.push({ text, style: st });
  };
  let at = 0;
  for (const m of input.matchAll(TAG_RE)) {
    push(input.slice(at, m.index));
    at = (m.index ?? 0) + m[0].length;
    if (!m[2]) {
      push("\n");
      continue;
    }
    const close = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (tag === "q") {
      push(close ? "”" : "“");
      continue;
    }
    const keys = tag === "bi" ? ["b", "i"] : [tag];
    for (const k of keys) counts[k] = close ? Math.max(0, counts[k] - 1) : counts[k] + 1;
  }
  push(input.slice(at));
  return out.map((s) => ({ ...s, text: unescape(s.text) }));
}

function sameStyle(a: Style, b: Style) {
  return a.b === b.b && a.i === b.i && a.c === b.c && a.u === b.u && a.s === b.s;
}

/** Remove every formatting tag (og:title, og:description, plain networks). */
export function stripFormatting(input: string): string {
  return parseFormatted(input).map((s) => s.text).join("");
}

/** URLs, #hashtags and @handles are protected from restyling. */
const PROTECTED_RE = /(?:https?:\/\/|mailto:|www\.)[^\s<>"]+|[#@][\p{L}\p{N}_]+/giu;

function splitProtected(text: string): { text: string; safe: boolean }[] {
  const parts: { text: string; safe: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(PROTECTED_RE)) {
    if ((m.index ?? 0) > at) parts.push({ text: text.slice(at, m.index), safe: false });
    parts.push({ text: m[0], safe: true });
    at = (m.index ?? 0) + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), safe: false });
  return parts;
}

// Mathematical Alphanumeric Symbols (sans-serif family reads best in feeds).
const RANGES = {
  bold: { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec },
  italic: { upper: 0x1d608, lower: 0x1d622, digit: null },
  boldItalic: { upper: 0x1d63c, lower: 0x1d656, digit: 0x1d7ec },
  mono: { upper: 0x1d670, lower: 0x1d68a, digit: 0x1d7f6 },
} as const;

function styleChar(ch: string, range: { upper: number; lower: number; digit: number | null }): string {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 65 && code <= 90) return String.fromCodePoint(range.upper + code - 65);
  if (code >= 97 && code <= 122) return String.fromCodePoint(range.lower + code - 97);
  if (code >= 48 && code <= 57 && range.digit !== null) return String.fromCodePoint(range.digit + code - 48);
  return ch;
}

function unicodeText(text: string, st: Style): string {
  const range = st.c ? RANGES.mono : st.b && st.i ? RANGES.boldItalic : st.b ? RANGES.bold : st.i ? RANGES.italic : null;
  let out = "";
  for (const ch of text) {
    let piece = range ? styleChar(ch, range) : ch;
    if (!/\s/.test(ch)) {
      if (st.u) piece += "\u0332";
      if (st.s) piece += "\u0336";
    }
    out += piece;
  }
  return out;
}

/** Wrap with WhatsApp markers; surrounding spaces stay outside the markers (WhatsApp needs that). */
function whatsappText(text: string, st: Style): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const [lead, core, trail] = m ? [m[1], m[2], m[3]] : ["", text, ""];
  if (!core) return text;
  if (st.c) return core.includes("\n") ? `${lead}\`\`\`${core}\`\`\`${trail}` : `${lead}\`${core}\`${trail}`;
  let inner = core;
  if (st.s) inner = `~${inner}~`;
  if (st.i) inner = `_${inner}_`;
  if (st.b) inner = `*${inner}*`;
  return lead + inner + trail;
}

/** Telegram apps' typed shortcuts (converted by the app on send). */
function telegramText(text: string, st: Style): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const [lead, core, trail] = m ? [m[1], m[2], m[3]] : ["", text, ""];
  if (!core) return text;
  if (st.c) return core.includes("\n") ? `${lead}\`\`\`${core}\`\`\`${trail}` : `${lead}\`${core}\`${trail}`;
  let inner = core;
  if (st.s) inner = `~~${inner}~~`;
  if (st.i) inner = `__${inner}__`;
  if (st.b) inner = `**${inner}**`;
  return lead + inner + trail;
}

/** Slack mrkdwn: like WhatsApp, but inline code is always single backticks. */
function slackText(text: string, st: Style): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const [lead, core, trail] = m ? [m[1], m[2], m[3]] : ["", text, ""];
  if (!core) return text;
  if (st.c) return `${lead}\`${core}\`${trail}`;
  let inner = core;
  if (st.s) inner = `~${inner}~`;
  if (st.i) inner = `_${inner}_`;
  if (st.b) inner = `*${inner}*`;
  return lead + inner + trail;
}

/** Markdown (Discord flavour; Reddit ignores __ as underline and shows bold). */
function markdownText(text: string, st: Style): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const [lead, core, trail] = m ? [m[1], m[2], m[3]] : ["", text, ""];
  if (!core) return text;
  if (st.c) return `${lead}\`${core}\`${trail}`;
  let inner = core;
  if (st.u) inner = `__${inner}__`;
  if (st.s) inner = `~~${inner}~~`;
  if (st.i) inner = `*${inner}*`;
  if (st.b) inner = `**${inner}**`;
  return lead + inner + trail;
}

const MARKUP: Record<Exclude<ShareFormat, "plain" | "unicode">, (text: string, st: Style) => string> = {
  whatsapp: whatsappText,
  telegram: telegramText,
  slack: slackText,
  markdown: markdownText,
};

/** Convert tagged text for one target format. */
export function formatShareText(input: string, format: ShareFormat | string): string {
  const segments = parseFormatted(input);
  const markup = format in MARKUP ? MARKUP[format as keyof typeof MARKUP] : null;
  if (format !== "unicode" && !markup) return segments.map((s) => s.text).join("");
  return segments
    .map((s) => {
      const styled = s.style.b || s.style.i || s.style.c || s.style.u || s.style.s;
      if (!styled) return s.text;
      // URLs, hashtags and handles are never restyled or wrapped in markers.
      return splitProtected(s.text)
        .map((p) => (p.safe ? p.text : markup ? markup(p.text, s.style) : unicodeText(p.text, s.style)))
        .join("");
    })
    .join("");
}

/** Problems with tags in a template (shown under the field; never blocks unknown text). */
export function formattingProblems(input: string): string[] {
  const problems: string[] = [];
  const open: Record<string, number> = {};
  for (const m of input.matchAll(TAG_RE)) {
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1] === "/") {
      if (!open[tag]) problems.push(`</${tag}> has no matching <${tag}>.`);
      else open[tag] -= 1;
    } else open[tag] = (open[tag] ?? 0) + 1;
  }
  for (const [tag, n] of Object.entries(open)) if (n > 0) problems.push(`<${tag}> is not closed with </${tag}>.`);
  return problems;
}
