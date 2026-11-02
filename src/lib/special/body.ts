/**
 * t173: Special Articles — the long-form body format stored in R2.
 *
 * Pure module (no runtime bindings) so it can be unit-tested with
 * `node --experimental-strip-types`. The body is an immutable JSON document;
 * every save writes a new version (see special-store.ts).
 *
 * Safety: every text field is plain text with the site's inline markdown
 * (bold, italic, links) rendered by the safe inline renderer — never HTML.
 * The sanitizer strips HTML tags, control characters and unsafe URLs.
 */
import { z } from "zod";
import type { ArticleBlock } from "../../content/types.ts";
import { bodyToBlocks } from "../automation/body.ts";
import { blocksPlainText } from "../../content/block-text.ts";
import { inlinePlain } from "../inline-markdown.ts";

export const SPECIAL_BODY_SCHEMA = "dypol.special-body";
export const SPECIAL_MAX_BLOCKS = 600;
export const SPECIAL_MAX_BODY_BYTES = 2_000_000;

export type SpecialHeading = { type: "heading"; level: 1 | 2 | 3; text: string };
export type SpecialImage = { type: "image"; mediaId: string; alt: string; caption?: string; credit?: string; width?: number; height?: number };
export type ChartKind = "bar" | "line" | "pie";
export type ChartData = { labels: string[]; series: { name: string; values: number[] }[] };
export type SpecialChart = {
  type: "chart";
  chartId: string;
  kind: ChartKind;
  title: string;
  caption?: string;
  data: ChartData;
  /** Ids of the sources / datasets the numbers come from (traceability). */
  sourceIds: string[];
  /** R2 key of the rendered SVG (set by the store when the chart is saved). */
  key?: string;
};
export type SpecialTable = { type: "table"; headers: string[]; rows: string[][]; caption?: string; align?: ("left" | "center" | "right" | "")[] };
export type SpecialBlock =
  | SpecialHeading
  | SpecialImage
  | SpecialChart
  | SpecialTable
  | Exclude<ArticleBlock, { type: "heading" } | { type: "table" }>;

export type SourceKind = "web" | "academic" | "dataset" | "document" | "news" | "other";
export type SpecialSource = {
  id: string;
  title: string;
  url: string;
  kind: SourceKind;
  publisher?: string;
  authors?: string;
  publishedAt?: string;
  accessedAt?: string;
  doi?: string;
  note?: string;
};
export type ResourceProvider = "link" | "google-drive" | "onedrive" | "dropbox" | "proton-drive";
export type SpecialResource = {
  id: string;
  title: string;
  url: string;
  provider: ResourceProvider;
  mime?: string;
  size?: number;
  description?: string;
};

export type SpecialBody = {
  schema: typeof SPECIAL_BODY_SCHEMA;
  version: number;
  articleId: string;
  savedAt: string;
  blocks: SpecialBlock[];
  sources: SpecialSource[];
  resources: SpecialResource[];
  coverCredit?: string;
};

/* ---------- sanitizing ---------- */

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
const TAGS = /<\/?[a-zA-Z][^<>]*>/g;
const SCRIPTISH = /\b(?:javascript|vbscript|data)\s*:/gi;

/** Plain text: no HTML tags, no control / bidi characters, no script: URLs inside inline links. */
export function cleanText(value: string, max = 20_000): string {
  return value
    .replace(CONTROL, "")
    .replace(TAGS, "")
    .replace(/\]\(\s*(?:javascript|vbscript|data)\s*:[^)]*\)/gi, "]()")
    .replace(SCRIPTISH, (m) => m.replace(":", "\u200a:"))
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .slice(0, max);
}

/** https URLs only (or a site-relative path for internal links), no credentials. */
export function safeUrl(raw: string): string | null {
  const v = raw.trim();
  if (/^\/(?!\/)[\w\-./~%?#=&]*$/.test(v)) return v;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const text = (max: number) => z.string().max(max * 2).transform((v) => cleanText(v, max));
const optText = (max: number) => text(max).optional().transform((v) => (v ? v : undefined));
const idText = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_.:-]+$/);
const urlText = z.string().max(2048).transform((v, ctx) => {
  const u = safeUrl(v);
  if (!u) {
    ctx.addIssue({ code: "custom", message: "Links must be https URLs." });
    return z.NEVER;
  }
  return u;
});

const headingSchema = z.object({ type: z.literal("heading"), level: z.union([z.literal(1), z.literal(2), z.literal(3)]), text: text(300) });
const paragraphSchema = z.object({ type: z.literal("paragraph"), text: text(20_000) });
const listSchema = z.object({ type: z.literal("list"), ordered: z.boolean().optional(), items: z.array(text(4000)).min(1).max(200), children: z.array(z.array(text(4000)).max(50)).max(200).optional() });
const quoteSchema = z.object({ type: z.literal("quote"), text: text(4000), attribution: optText(300) });
const calloutSchema = z.object({ type: z.literal("callout"), tone: z.enum(["note", "takeaway", "tip", "warning"]), title: optText(120), text: text(4000) });
const codeSchema = z.object({ type: z.literal("code"), language: z.string().max(40).regex(/^[\w+-]*$/).optional(), code: z.string().max(20_000).transform((v) => v.replace(CONTROL, "")) });
const tableSchema = z.object({
  type: z.literal("table"),
  headers: z.array(text(300)).max(20),
  rows: z.array(z.array(text(1000)).max(20)).max(500),
  caption: optText(400),
  align: z.array(z.enum(["left", "center", "right", ""])).max(20).optional(),
});
const specsSchema = z.object({ type: z.literal("specs"), title: optText(200), rows: z.array(z.array(text(500)).max(2)).max(60) });
const dividerSchema = z.object({ type: z.literal("divider") });
const takeawaysSchema = z.object({ type: z.literal("takeaways"), items: z.array(text(600)).min(1).max(8) });
const imageSchema = z.object({
  type: z.literal("image"),
  mediaId: idText,
  alt: text(300),
  caption: optText(600),
  credit: optText(300),
  width: z.number().int().min(0).max(20_000).optional(),
  height: z.number().int().min(0).max(20_000).optional(),
});
const chartSchema = z.object({
  type: z.literal("chart"),
  chartId: z.string().trim().max(40).regex(/^[a-z0-9-]*$/).default(""),
  kind: z.enum(["bar", "line", "pie"]),
  title: text(200),
  caption: optText(600),
  data: z.object({
    labels: z.array(text(80)).min(1).max(60),
    series: z.array(z.object({ name: text(80), values: z.array(z.number().finite()).max(60) })).min(1).max(6),
  }),
  sourceIds: z.array(idText).max(20).default([]),
  key: z.string().max(200).optional(),
});

export const specialBlockSchema = z.discriminatedUnion("type", [
  headingSchema, paragraphSchema, listSchema, quoteSchema, calloutSchema, codeSchema, tableSchema,
  specsSchema, dividerSchema, takeawaysSchema, imageSchema, chartSchema,
]);

export const specialSourceSchema = z.object({
  id: idText,
  title: text(400),
  url: urlText,
  kind: z.enum(["web", "academic", "dataset", "document", "news", "other"]).default("web"),
  publisher: optText(200),
  authors: optText(400),
  publishedAt: optText(40),
  accessedAt: optText(40),
  doi: optText(120),
  note: optText(600),
});

export const specialResourceSchema = z.object({
  id: idText,
  title: text(300),
  url: urlText,
  provider: z.enum(["link", "google-drive", "onedrive", "dropbox", "proton-drive"]).default("link"),
  mime: optText(120),
  size: z.number().int().min(0).max(1e12).optional(),
  description: optText(600),
});

/** What the editor / MCP sends; the store adds schema, version, articleId and savedAt. */
export const specialContentSchema = z.object({
  blocks: z.array(specialBlockSchema).max(SPECIAL_MAX_BLOCKS),
  sources: z.array(specialSourceSchema).max(200).default([]),
  resources: z.array(specialResourceSchema).max(100).default([]),
  coverCredit: optText(300),
});
export type SpecialContent = { blocks: SpecialBlock[]; sources: SpecialSource[]; resources: SpecialResource[]; coverCredit?: string };

export class SpecialBodyError extends Error {}

/** Validates and cleans editor / AI input. Throws SpecialBodyError with a readable message. */
export function sanitizeSpecialContent(raw: unknown): SpecialContent {
  const parsed = specialContentSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SpecialBodyError(`Special article body is invalid at ${issue?.path.join(".") || "body"}: ${issue?.message ?? "bad value"}`);
  }
  const content = parsed.data;
  // Drop blocks that became empty after cleaning, give charts stable ids, check chart shapes.
  const usedChartIds = new Set<string>();
  const blocks: SpecialBlock[] = [];
  for (const block of content.blocks as SpecialBlock[]) {
    if ((block.type === "paragraph" || block.type === "heading") && !block.text.trim()) continue;
    if (block.type === "chart") {
      let id = block.chartId || `chart-${usedChartIds.size + 1}`;
      while (usedChartIds.has(id)) id = `${id}-x`;
      usedChartIds.add(id);
      for (const s of block.data.series) {
        if (s.values.length !== block.data.labels.length) throw new SpecialBodyError(`Chart “${block.title}”: series “${s.name}” needs one value per label.`);
      }
      if (block.kind === "pie" && block.data.series[0].values.some((v) => v < 0)) throw new SpecialBodyError(`Chart “${block.title}”: a pie chart cannot have negative values.`);
      blocks.push({ ...block, chartId: id });
      continue;
    }
    blocks.push(block);
  }
  const sourceIds = new Set<string>();
  const sources = content.sources.filter((s) => (sourceIds.has(s.id) ? false : (sourceIds.add(s.id), true)));
  const resourceIds = new Set<string>();
  const resources = content.resources.filter((r) => (resourceIds.has(r.id) ? false : (resourceIds.add(r.id), true)));
  return { blocks, sources: sources as SpecialSource[], resources: resources as SpecialResource[], ...(content.coverCredit ? { coverCredit: content.coverCredit } : {}) };
}

export function buildBody(articleId: string, version: number, content: SpecialContent, savedAt = new Date().toISOString()): SpecialBody {
  return { schema: SPECIAL_BODY_SCHEMA, version, articleId, savedAt, blocks: content.blocks, sources: content.sources, resources: content.resources, ...(content.coverCredit ? { coverCredit: content.coverCredit } : {}) };
}

/** Parses a stored body object; null when it is not a special body. */
export function parseStoredBody(raw: unknown): SpecialBody | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Partial<SpecialBody>;
  if (v.schema !== SPECIAL_BODY_SCHEMA || !Array.isArray(v.blocks)) return null;
  return { schema: SPECIAL_BODY_SCHEMA, version: Number(v.version ?? 0), articleId: String(v.articleId ?? ""), savedAt: String(v.savedAt ?? ""), blocks: v.blocks, sources: Array.isArray(v.sources) ? v.sources : [], resources: Array.isArray(v.resources) ? v.resources : [], ...(v.coverCredit ? { coverCredit: String(v.coverCredit) } : {}) };
}

/* ---------- derived text ---------- */

/** Regular-article blocks equivalent (images/charts become their caption text) for text tools. */
export function toArticleBlocks(blocks: SpecialBlock[]): ArticleBlock[] {
  const out: ArticleBlock[] = [];
  for (const b of blocks) {
    if (b.type === "heading") out.push({ type: "heading", level: (b.level + 1) as 2 | 3 | 4, text: b.text });
    else if (b.type === "image") { if (b.caption) out.push({ type: "paragraph", text: b.caption }); }
    else if (b.type === "chart") out.push({ type: "paragraph", text: [b.title, b.caption].filter(Boolean).join(". ") });
    else if (b.type === "table") out.push({ type: "table", headers: b.headers, rows: b.rows, ...(b.align ? { align: b.align } : {}) });
    else out.push(b);
  }
  return out;
}

export function specialPlainText(blocks: SpecialBlock[]): string {
  return blocksPlainText(toArticleBlocks(blocks));
}

export function specialWordCount(blocks: SpecialBlock[]): number {
  return (specialPlainText(blocks).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

export function headingId(textValue: string): string {
  return inlinePlain(textValue).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 80);
}

export type TocEntry = { id: string; text: string; level: 1 | 2 };
/** Table of contents: writer H1 and H2 sections (H3 stays in the body only). */
export function specialToc(blocks: SpecialBlock[]): TocEntry[] {
  const seen = new Map<string, number>();
  const out: TocEntry[] = [];
  for (const b of blocks) {
    if (b.type !== "heading" || b.level === 3) continue;
    const base = headingId(b.text) || "section";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({ id: n > 1 ? `${base}-${n}` : base, text: inlinePlain(b.text), level: b.level });
  }
  return out;
}

/** All https links in the body (inline links, sources, resources) for link validation. */
export function specialLinks(content: Pick<SpecialContent, "blocks" | "sources" | "resources">): string[] {
  const urls = new Set<string>();
  const scan = (t: string) => {
    for (const m of t.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)) urls.add(m[1]);
    for (const m of t.matchAll(/(?<![(\w])(https:\/\/[^\s)<>\]]+)/g)) urls.add(m[1].replace(/[.,;:!?]+$/, ""));
  };
  for (const b of content.blocks) {
    if ("text" in b && typeof b.text === "string") scan(b.text);
    if (b.type === "list") b.items.forEach(scan);
    if (b.type === "table") b.rows.flat().forEach(scan);
    if (b.type === "image" && b.caption) scan(b.caption);
  }
  for (const s of content.sources) urls.add(s.url);
  for (const r of content.resources) urls.add(r.url);
  return [...urls];
}

/* ---------- markdown intake (MCP) ---------- */

const IMAGE_LINE = /^!\[([^\]]*)\]\(media:([A-Za-z0-9_.:-]{1,80})(?:\s+"([^"]*)")?\)\s*$/;
const H1_LINE = /^#\s+(.+?)\s*#*\s*$/;
const H2_LINE = /^##\s+(.+?)\s*#*\s*$/;
const H3_LINE = /^#{3,6}\s+(.+?)\s*#*\s*$/;
const TABLE_CAPTION = /^(?:table|caption)\s*:\s*(.+)$/i;

/**
 * Markdown -> special blocks. Everything the regular body format supports, plus:
 * - "# " H1, "## " H2, "### " H3 section headings (H1 is a top-level section; the title stays the page H1)
 * - `![alt](media:MEDIA_ID "caption")` on its own line: an image from the media library
 * - a ```chart fence holding JSON {kind, title, labels, series:[{name, values}], caption?, sourceIds?}
 * - "Table: caption" on the line right after a table: the table caption
 */
export function markdownToSpecialBlocks(markdown: string): SpecialBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: SpecialBlock[] = [];
  let chunk: string[] = [];
  const flush = () => {
    if (!chunk.some((l) => l.trim())) { chunk = []; return; }
    for (const b of bodyToBlocks(chunk.join("\n"))) {
      if (b.type === "heading") out.push({ type: "heading", level: 3, text: b.text });
      else out.push(b as SpecialBlock);
    }
    chunk = [];
  };
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!inFence && /^```\s*chart\s*$/i.test(trimmed)) {
      flush();
      const json: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) json.push(lines[i++]);
      let spec: Record<string, unknown>;
      try {
        spec = JSON.parse(json.join("\n")) as Record<string, unknown>;
      } catch {
        throw new SpecialBodyError("A ```chart block must hold valid JSON: {\"kind\":\"bar\",\"title\":\"…\",\"labels\":[…],\"series\":[{\"name\":\"…\",\"values\":[…]}]}.");
      }
      out.push({
        type: "chart",
        chartId: typeof spec.id === "string" ? spec.id : "",
        kind: (spec.kind ?? "bar") as ChartKind,
        title: String(spec.title ?? "Chart"),
        ...(typeof spec.caption === "string" ? { caption: spec.caption } : {}),
        data: { labels: (spec.labels ?? []) as string[], series: (spec.series ?? []) as ChartData["series"] },
        sourceIds: Array.isArray(spec.sourceIds) ? (spec.sourceIds as string[]) : [],
      });
      continue;
    }
    if (/^```/.test(trimmed)) inFence = !inFence;
    if (!inFence) {
      const img = IMAGE_LINE.exec(trimmed);
      const h1 = H1_LINE.exec(trimmed);
      const h2 = !h1 && H2_LINE.exec(trimmed);
      const h3 = !h1 && !h2 && H3_LINE.exec(trimmed);
      if (img) {
        flush();
        out.push({ type: "image", alt: img[1].trim(), mediaId: img[2], ...(img[3]?.trim() ? { caption: img[3].trim() } : {}) });
        continue;
      }
      // Headings that start a takeaways / specs box stay with bodyToBlocks.
      const special = /^(at a glance|key takeaways|tl;?dr|(key\s+)?specs?|specifications)\b/i;
      if (h1 || h2) {
        const t = (h1 || h2) as RegExpExecArray;
        if (!special.test(t[1].replace(/[*_`]/g, ""))) {
          flush();
          out.push({ type: "heading", level: h1 ? 1 : 2, text: t[1].trim() });
          continue;
        }
      }
      if (h3 && !special.test(h3[1].replace(/[*_`]/g, ""))) {
        flush();
        out.push({ type: "heading", level: 3, text: h3[1].trim() });
        continue;
      }
      const cap = TABLE_CAPTION.exec(trimmed);
      if (cap && chunk.length && /\|/.test(chunk[chunk.length - 1] ?? "")) {
        flush();
        const last = out[out.length - 1];
        if (last?.type === "table") last.caption = cap[1].trim();
        continue;
      }
    }
    chunk.push(line);
  }
  flush();
  return out;
}

/** Special blocks -> markdown (what get_article returns to an AI for editing). */
export function specialBlocksToMarkdown(blocks: SpecialBlock[]): string {
  const parts: string[] = [];
  const row = (cells: string[]) => "| " + cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ") + " |";
  for (const b of blocks) {
    if (b.type === "heading") parts.push(`${"#".repeat(b.level)} ${b.text}`);
    else if (b.type === "paragraph") parts.push(b.text);
    else if (b.type === "list") parts.push(b.items.map((it, i) => `${b.ordered ? `${i + 1}.` : "-"} ${it}`).join("\n"));
    else if (b.type === "quote") parts.push(`> ${b.text}${b.attribution ? `\n> — ${b.attribution}` : ""}`);
    else if (b.type === "callout") parts.push(`> **${b.title || b.tone[0].toUpperCase() + b.tone.slice(1)}:** ${b.text}`);
    else if (b.type === "code") parts.push("```" + (b.language ?? "") + "\n" + b.code + "\n```");
    else if (b.type === "table") parts.push([row(b.headers), row(b.headers.map(() => "---")), ...b.rows.map(row)].join("\n") + (b.caption ? `\nTable: ${b.caption}` : ""));
    else if (b.type === "specs") parts.push("```specs" + (b.title ? ` ${b.title}` : "") + "\n" + b.rows.map((r) => `${r[0] ?? ""}: ${r[1] ?? ""}`).join("\n") + "\n```");
    else if (b.type === "divider") parts.push("---");
    else if (b.type === "takeaways") parts.push("## At a glance\n" + b.items.map((it) => `- ${it}`).join("\n"));
    else if (b.type === "image") parts.push(`![${b.alt}](media:${b.mediaId}${b.caption ? ` "${b.caption.replace(/"/g, "'")}"` : ""})`);
    else if (b.type === "chart") parts.push("```chart\n" + JSON.stringify({ id: b.chartId, kind: b.kind, title: b.title, ...(b.caption ? { caption: b.caption } : {}), labels: b.data.labels, series: b.data.series, sourceIds: b.sourceIds }) + "\n```");
  }
  return parts.join("\n\n");
}
