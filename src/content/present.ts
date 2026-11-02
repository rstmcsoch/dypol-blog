import type { ArticleBlock } from "./types";
import { blocksPlainText } from "./block-text.ts";

export function readingMinutes(article: { blocks: ArticleBlock[]; articleType?: string; wordCount?: number }): number {
  // t173: a special article's body lives in R2; its stored word count stands in.
  if (article.articleType === "special" && typeof article.wordCount === "number") return Math.max(1, Math.round(article.wordCount / 220));
  const words = blockText(article.blocks).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

function blockText(blocks: ArticleBlock[]): string {
  return blocksPlainText(blocks, { includeCode: true });
}

export type ArticleMeta = {
  rank: number;
  categoryLabel: string;
  /** Labels of every topic the article is filed under, primary first. */
  topicLabels: string[];
  minutes: number;
};
