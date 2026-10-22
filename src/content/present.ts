import type { ArticleBlock } from "./types";

export function readingMinutes(article: { blocks: ArticleBlock[] }): number {
  const words = articlePlainText(article.blocks, " ").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/** Visible text of article blocks. Every block type is handled so a new
 *  table or takeaways box cannot crash callers (the RSS feed did). */
export function articlePlainText(blocks: ArticleBlock[], separator = "\n\n"): string {
  return blocks
    .map((block) => {
      if (block.type === "list" || block.type === "takeaways") return block.items.join("\n");
      if (block.type === "table") return [block.headers.join(" | "), ...block.rows.map((row) => row.join(" | "))].join("\n");
      if (block.type === "code") return block.code;
      return block.text;
    })
    .map((part) => part.trim())
    .filter(Boolean)
    .join(separator);
}

export type ArticleMeta = {
  rank: number;
  categoryLabel: string;
  /** Labels of every topic the article is filed under, primary first. */
  topicLabels: string[];
  minutes: number;
};
