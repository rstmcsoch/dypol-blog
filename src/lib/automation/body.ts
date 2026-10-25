import type { ArticleBlock } from "../../content/types.ts";
import { blocksPlainText } from "../../content/block-text.ts";

/**
 * Converts the markdown body an automation sends into article blocks.
 * Supported (t106, GitHub-flavoured subset, no raw HTML):
 * - paragraphs (blank-line separated); inline **bold**, *italic*, ***both***,
 *   ~~strike~~, `code`, [links](https://…) and bare URLs are kept as text and
 *   rendered by the inline renderer.
 * - "## " / "### " / "#### " headings ("# " becomes a level-2 heading)
 * - "- " / "* " / "1. " lists, with one level of nested items (indent 2+ spaces)
 * - "> " quotes ("> — Name" last line = attribution); a quote that starts with
 *   **Note:** / **Key takeaway:** / **Tip:** / **Warning:** (or [!NOTE] etc.)
 *   becomes a callout box
 * - GFM pipe tables with :--- / :---: / ---: alignment
 * - a key-specs card: a ```specs fence of "Label: Value" lines (optional title
 *   after the word specs), or a "Specs" / "Key specs" / "Specifications"
 *   heading followed by a two-column table or a "Label: Value" list
 * - "## At a glance" / "## Key takeaways" / "## TL;DR" + list -> takeaways box
 * - "---" / "***" / "___" -> divider; ``` fenced code
 */
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const SPECS_TITLE_RE = /^(key\s+)?(specs?|specifications|spec\s+sheet|tech(nical)?\s+specs?|specs\s+at\s+a\s+glance)\b/i;
const TAKEAWAYS_RE = /^(at a glance|key takeaways|tl;?dr)$/i;
const CALLOUT_RE = /^(?:\*\*|__)?\s*(note|key takeaway|takeaway|tip|pro tip|warning|caution|heads up|important|bottom line)\s*[:.]?\s*(?:\*\*|__)\s*:?\s*/i;
const GH_ALERT_RE = /^\[!(note|tip|important|warning|caution)\]\s*/i;

function splitRow(row: string): string[] {
  let r = row.trim();
  if (r.startsWith("|")) r = r.slice(1);
  if (r.endsWith("|") && !r.endsWith("\\|")) r = r.slice(0, -1);
  return r.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function isTableStart(lines: string[], i: number): boolean {
  const line = lines[i] ?? "";
  const next = lines[i + 1] ?? "";
  return line.includes("|") && TABLE_SEP_RE.test(next) && next.includes("-") && (next.includes("|") || line.trim().startsWith("|"));
}

function parseTable(lines: string[], i: number): { headers: string[]; rows: string[][]; align: ("left" | "center" | "right" | "")[]; next: number } {
  const headers = splitRow(lines[i]);
  const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : "")) as ("left" | "center" | "right" | "")[];
  let j = i + 2;
  const rows: string[][] = [];
  while (j < lines.length && lines[j].trim() && lines[j].includes("|") && !HR_RE.test(lines[j])) rows.push(splitRow(lines[j++]));
  return { headers, rows, align, next: j };
}

function calloutTone(word: string): "note" | "takeaway" | "tip" | "warning" {
  const w = word.toLowerCase();
  if (w.includes("takeaway") || w === "bottom line" || w === "important") return "takeaway";
  if (w.includes("tip")) return "tip";
  if (w === "warning" || w === "caution" || w === "heads up") return "warning";
  return "note";
}

function titleCase(word: string): string {
  const w = word.trim();
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

/** "Label: Value" lines (optionally list-marked or **bold** labels) -> spec rows; null if any line does not fit. */
function specRows(lines: string[]): string[][] | null {
  const rows: string[][] = [];
  for (const raw of lines) {
    const line = raw.replace(/^\s*([-*+]|\d+[.)])\s+/, "").trim();
    if (!line) continue;
    const m = /^(?:\*\*|__)?([^:*_][^:]{0,80}?)(?:\*\*|__)?\s*[:：]\s*(?:\*\*|__)?\s*(.+)$/.exec(line);
    if (!m) return null;
    rows.push([m[1].replace(/[*_]+$/, "").trim(), m[2].trim()]);
  }
  return rows.length ? rows : null;
}

function parseList(lines: string[], i: number): { block: ArticleBlock; next: number } {
  const first = LIST_RE.exec(lines[i])!;
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items: string[] = [];
  const children: string[][] = [];
  let j = i;
  while (j < lines.length) {
    const line = lines[j];
    if (!line.trim()) {
      // A blank line ends the list unless the next line is another item of it.
      const k = j + 1;
      const m = k < lines.length ? LIST_RE.exec(lines[k]) : null;
      if (m && m[1].length >= baseIndent && (m[1].length > baseIndent || /\d/.test(m[2]) === ordered)) {
        j = k;
        continue;
      }
      break;
    }
    if (HR_RE.test(line) && !LIST_RE.exec(line)?.[3]?.trim()) break;
    const m = LIST_RE.exec(line);
    if (m && m[1].length >= baseIndent + 2 && items.length) {
      (children[items.length - 1] ??= []).push(m[3].trim());
      j += 1;
      continue;
    }
    if (m && m[1].length <= baseIndent + 1) {
      if (/\d/.test(m[2]) !== ordered) break;
      items.push(m[3].trim());
      j += 1;
      continue;
    }
    if (/^\s{2,}\S/.test(line) && items.length) {
      const kids = children[items.length - 1];
      if (kids?.length) kids[kids.length - 1] += ` ${line.trim()}`;
      else items[items.length - 1] += ` ${line.trim()}`;
      j += 1;
      continue;
    }
    break;
  }
  const hasKids = children.some((c) => c?.length);
  const block: ArticleBlock = {
    type: "list",
    ...(ordered ? { ordered: true } : {}),
    items,
    ...(hasKids ? { children: items.map((_, n) => children[n] ?? []) } : {}),
  };
  return { block, next: j };
}

function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i];
  return /^(```|#{1,6}\s|\s*>)/.test(line) || LIST_RE.test(line) || HR_RE.test(line) || isTableStart(lines, i);
}

export function bodyToBlocks(body: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  const lines = body.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  let i = 0;
  const nextNonBlank = (from: number) => {
    let j = from;
    while (j < lines.length && !lines[j].trim()) j += 1;
    return j;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const fence = /^```\s*([\w+-]{0,40})\s*(.*)$/.exec(line.trim());
    if (fence) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) code.push(lines[i++]);
      i += 1;
      if (fence[1].toLowerCase() === "specs") {
        const rows = specRows(code);
        if (rows) {
          const title = fence[2].trim();
          blocks.push({ type: "specs", ...(title ? { title } : {}), rows: rows.slice(0, 40) });
          continue;
        }
      }
      blocks.push({ type: "code", ...(fence[1] ? { language: fence[1] } : {}), code: code.join("\n") });
      continue;
    }
    if (HR_RE.test(line)) {
      blocks.push({ type: "divider" });
      i += 1;
      continue;
    }
    if (isTableStart(lines, i)) {
      const t = parseTable(lines, i);
      i = t.next;
      if (t.rows.length) blocks.push({ type: "table", headers: t.headers, rows: t.rows, ...(t.align.some(Boolean) ? { align: t.align } : {}) });
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (heading) {
      const hashes = heading[1].length;
      const level = (hashes <= 2 ? 2 : hashes === 3 ? 3 : 4) as 2 | 3 | 4;
      const headingText = heading[2].trim();
      const plain = headingText.replace(/[*_`]/g, "").replace(/[:.]$/, "").trim();
      const j = nextNonBlank(i + 1);
      // "## At a glance" / "## Key takeaways" + list -> takeaways box.
      if (level <= 3 && TAKEAWAYS_RE.test(plain) && j < lines.length && LIST_RE.test(lines[j])) {
        const { block, next } = parseList(lines, j);
        if (block.type === "list" && block.items.length) {
          blocks.push({ type: "takeaways", items: block.items.slice(0, 6) });
          i = next;
          continue;
        }
      }
      // "### Key specs" + two-column table or "Label: Value" list -> specs card.
      if (SPECS_TITLE_RE.test(plain) && j < lines.length) {
        if (isTableStart(lines, j)) {
          const t = parseTable(lines, j);
          if (t.headers.length === 2 && t.rows.length && t.rows.every((r) => r.length <= 2)) {
            const headerIsLabel = /^(spec|specs|feature|item|label|component|detail)s?$/i.test(t.headers[0].replace(/[*_]/g, ""));
            const rows = headerIsLabel || !t.headers[0] ? t.rows : [t.headers, ...t.rows];
            blocks.push({ type: "specs", title: headingText, rows: rows.map((r) => [r[0] ?? "", r[1] ?? ""]).slice(0, 40) });
            i = t.next;
            continue;
          }
        } else if (LIST_RE.test(lines[j])) {
          const { block, next } = parseList(lines, j);
          const rows = block.type === "list" ? specRows(block.items) : null;
          if (rows) {
            blocks.push({ type: "specs", title: headingText, rows: rows.slice(0, 40) });
            i = next;
            continue;
          }
        } else if (/^```\s*specs\b/i.test(lines[j].trim())) {
          // Heading + ```specs fence: the heading becomes the card title.
          const fenceLine = lines[j].trim();
          if (!/^```\s*specs\s+\S/i.test(fenceLine)) lines[j] = `\`\`\`specs ${headingText}`;
          i = j;
          continue;
        }
      }
      blocks.push({ type: "heading", level, text: headingText });
      i += 1;
      continue;
    }
    if (LIST_RE.test(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      let attribution: string | undefined;
      const last = (quote[quote.length - 1] ?? "").trim();
      if (quote.length > 1 && /^(—|–|--|-)\s*\S/.test(last)) {
        attribution = last.replace(/^(—|–|--|-)\s*/, "").trim();
        quote.pop();
      }
      let text = quote.map((q) => q.trim()).filter(Boolean).join(" ").trim();
      const alert = GH_ALERT_RE.exec(text);
      const callout = alert ?? CALLOUT_RE.exec(text);
      if (callout) {
        const word = callout[1];
        text = text.slice(callout[0].length).trim();
        blocks.push({ type: "callout", tone: calloutTone(word), title: alert ? titleCase(word) : titleCase(word).replace(/^Key takeaway$/, "Key takeaway"), text });
        continue;
      }
      blocks.push({ type: "quote", text, ...(attribution ? { attribution } : {}) });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !startsBlock(lines, i))) {
      para.push(lines[i].trim());
      i += 1;
      if (i < lines.length && startsBlock(lines, i)) break;
    }
    if (para.length) {
      // A trailing two-space or backslash hard break becomes a line break marker kept as a space.
      blocks.push({ type: "paragraph", text: para.join(" ").replace(/\s+/g, " ").trim() });
    } else i += 1;
  }
  return blocks;
}

/** Credit / source lines that belong in metadata, never in the public body. */
const CREDIT_LINE_RE = /^\s*(\*\*|_)?\s*(cover image|cover photo|featured image|header image|image|photo|image credit|photo credit|image source|credit|credits|via)\s*(\*\*|_)?\s*[:：]/i;
const SOURCES_HEADING_RE = /^(sources?|references|further reading|citations|credits|image credits?)\s*:?$/i;

/**
 * t106: removes in-body Sources/References sections and "Cover image: …" style
 * credit lines. Sources live in source_urls metadata and credits in the cover
 * credit field; the public body never lists them.
 */
export function stripCreditsAndSources(blocks: ArticleBlock[]): ArticleBlock[] {
  const out: ArticleBlock[] = [];
  let skipping = false;
  let skipLevel = 2;
  for (const block of blocks) {
    if (block.type === "heading") {
      const plain = block.text.replace(/[*_`]/g, "").trim();
      if (SOURCES_HEADING_RE.test(plain)) {
        skipping = true;
        skipLevel = block.level;
        continue;
      }
      if (skipping && block.level <= skipLevel) skipping = false;
    }
    if (skipping) continue;
    if (block.type === "paragraph" && CREDIT_LINE_RE.test(block.text) && block.text.length < 400) continue;
    if (block.type === "paragraph" && /^\s*(\*\*)?sources?\s*:?(\*\*)?\s*:?\s*https?:\/\//i.test(block.text)) continue;
    out.push(block);
  }
  while (out.length && out[out.length - 1].type === "divider") out.pop();
  return out;
}

export function wordCount(blocks: ArticleBlock[]): number {
  const text = blocksPlainText(blocks);
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

/** Stable hash of the substantive content, used to detect re-submissions. */
export async function contentHash(title: string, body: string): Promise<string> {
  const norm = `${title}\n${body}`.toLowerCase().replace(/\s+/g, " ").trim();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Inverse of bodyToBlocks: renders article blocks back to the markdown body format the MCP tools accept. */
export function blocksToBody(blocks: ArticleBlock[]): string {
  const parts: string[] = [];
  const row = (cells: string[]) => "| " + cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ") + " |";
  for (const block of blocks) {
    if (block.type === "paragraph") parts.push(block.text);
    else if (block.type === "heading") parts.push(`${"#".repeat(block.level)} ${block.text}`);
    else if (block.type === "list")
      parts.push(
        block.items
          .map((item, i) => {
            const head = block.ordered ? `${i + 1}. ${item}` : `- ${item}`;
            const kids = block.children?.[i] ?? [];
            return [head, ...kids.map((k) => `  - ${k}`)].join("\n");
          })
          .join("\n"),
      );
    else if (block.type === "quote") parts.push(`> ${block.text}${block.attribution ? `\n> — ${block.attribution}` : ""}`);
    else if (block.type === "table") {
      const sep = block.headers.map((_, i) => {
        const a = block.align?.[i];
        return a === "center" ? ":---:" : a === "right" ? "---:" : a === "left" ? ":---" : "---";
      });
      parts.push([row(block.headers), "| " + sep.join(" | ") + " |", ...block.rows.map(row)].join("\n"));
    } else if (block.type === "specs") parts.push("```specs" + (block.title ? ` ${block.title}` : "") + "\n" + block.rows.map((r) => `${r[0] ?? ""}: ${r[1] ?? ""}`).join("\n") + "\n```");
    else if (block.type === "callout") parts.push(`> **${block.title || titleCase(block.tone)}:** ${block.text}`);
    else if (block.type === "divider") parts.push("---");
    else if (block.type === "takeaways") parts.push("## At a glance\n" + block.items.map((item) => `- ${item}`).join("\n"));
    else if (block.type === "code") parts.push("```" + (block.language ?? "") + "\n" + block.code + "\n```");
  }
  return parts.join("\n\n");
}
