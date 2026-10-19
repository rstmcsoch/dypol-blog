import type { ArticleBlock } from "./types";

export function readingMinutes(article: { blocks: ArticleBlock[] }): number {
  const words = blockText(article.blocks).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

function blockText(blocks: ArticleBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "list" || block.type === "takeaways") return block.items.join(" ");
      if (block.type === "table") return [...block.headers, ...block.rows.flat()].join(" ");
      if (block.type === "code") return block.code;
      return block.text;
    })
    .join(" ");
}

export type ArticleMeta = {
  rank: number;
  categoryLabel: string;
  /** Labels of every topic the article is filed under, primary first. */
  topicLabels: string[];
  minutes: number;
};
