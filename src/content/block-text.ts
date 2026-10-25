import type { ArticleBlock } from "./types";

/** Plain text of one block (word counts, reading time, publish checks). Code is excluded unless asked. */
export function blockPlainText(block: ArticleBlock, opts: { includeCode?: boolean } = {}): string {
  switch (block.type) {
    case "list":
      return [...block.items, ...(block.children ?? []).flat()].join(" ");
    case "takeaways":
      return block.items.join(" ");
    case "table":
      return [...block.headers, ...block.rows.flat()].join(" ");
    case "specs":
      return [block.title ?? "", ...block.rows.flat()].join(" ");
    case "callout":
      return [block.title ?? "", block.text].join(" ");
    case "code":
      return opts.includeCode ? block.code : "";
    case "divider":
      return "";
    default:
      return block.text;
  }
}

export function blocksPlainText(blocks: ArticleBlock[], opts: { includeCode?: boolean } = {}): string {
  return blocks.map((b) => blockPlainText(b, opts)).join(" ");
}
