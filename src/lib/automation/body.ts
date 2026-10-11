import type { ArticleBlock } from "../../content/types.ts";

/**
 * Converts the plain/markdown-ish body an automation sends into article blocks.
 * Supported: paragraphs (blank-line separated), "## " / "### " headings,
 * "- " / "* " / "1. " lists, "> " quotes and ``` fenced code. No HTML.
 */
export function bodyToBlocks(body: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const fence = /^```\s*([\w+-]{0,40})\s*$/.exec(line.trim());
    if (fence) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) code.push(lines[i++]);
      i += 1;
      blocks.push({ type: "code", ...(fence[1] ? { language: fence[1] } : {}), code: code.join("\n") });
      continue;
    }
    const heading = /^(#{2,3})\s+(.+)$/.exec(line.trim());
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length as 2 | 3, text: heading[2].trim() });
      i += 1;
      continue;
    }
    if (/^#\s+/.test(line.trim())) {
      // A top-level heading would compete with the article title; keep it as a level-2 heading.
      blocks.push({ type: "heading", level: 2, text: line.trim().replace(/^#\s+/, "") });
      i += 1;
      continue;
    }
    if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, "").trim());
        i += 1;
      }
      blocks.push({ type: "list", ...(ordered ? { ordered: true } : {}), items });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ type: "quote", text: quote.join(" ").trim() });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,3}\s|\s*([-*]|\d+[.)])\s|\s*>)/.test(lines[i])) {
      para.push(lines[i].trim());
      i += 1;
    }
    if (para.length) blocks.push({ type: "paragraph", text: para.join(" ") });
    else i += 1;
  }
  return blocks;
}

export function wordCount(blocks: ArticleBlock[]): number {
  const text = blocks
    .map((b) => (b.type === "list" ? b.items.join(" ") : b.type === "code" ? "" : b.text))
    .join(" ");
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

/** Stable hash of the substantive content, used to detect re-submissions. */
export async function contentHash(title: string, body: string): Promise<string> {
  const norm = `${title}\n${body}`.toLowerCase().replace(/\s+/g, " ").trim();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
