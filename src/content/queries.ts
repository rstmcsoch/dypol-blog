import { articles } from "./articles";
import { site } from "./site";
import { categories, tags } from "./taxonomy";
import type { Article, ArticleBlock, Category, Tag } from "./types";

function byNewest(a: Article, b: Article): number {
  const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
  const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
  return bTime - aTime;
}

export function listPublished(): Article[] {
  return articles.filter((article) => article.status === "published" && article.publishedAt).sort(byNewest);
}

export function getPublishedBySlug(slug: string): Article | undefined {
  return listPublished().find((article) => article.slug === slug);
}

export function rankOf(slug: string): number {
  const index = listPublished().findIndex((article) => article.slug === slug);
  return index === -1 ? 0 : index + 1;
}

export function listCategories(): Category[] {
  return categories;
}

export function getCategory(idOrSlug: string): Category | undefined {
  return categories.find((category) => category.id === idOrSlug || category.slug === idOrSlug);
}

export function listPublishedByCategory(slug: string): Article[] {
  const category = getCategory(slug);
  if (!category) return [];
  return listPublished().filter((article) => article.categoryId === category.id);
}

export function publishedCount(categoryId: string): number {
  return listPublished().filter((article) => article.categoryId === categoryId).length;
}

export function getTag(id: string): Tag | undefined {
  return tags.find((tag) => tag.id === id || tag.slug === id);
}

export function tagsFor(article: Article): Tag[] {
  return article.tagIds.map((id) => getTag(id)).filter((tag): tag is Tag => Boolean(tag));
}

export function featuredArticle(): Article | undefined {
  const published = listPublished();
  return published.find((article) => article.featured) ?? published[0];
}

export function relatedArticles(article: Article, limit = 3): Article[] {
  const same = listPublished().filter(
    (item) => item.categoryId === article.categoryId && item.id !== article.id,
  );
  if (same.length >= limit) return same.slice(0, limit);
  const rest = listPublished().filter(
    (item) => item.id !== article.id && !same.some((picked) => picked.id === item.id),
  );
  return [...same, ...rest].slice(0, limit);
}

export function neighbors(article: Article): { newer?: Article; older?: Article } {
  const published = listPublished();
  const index = published.findIndex((item) => item.id === article.id);
  if (index === -1) return {};
  return {
    newer: published[index - 1],
    older: published[index + 1],
  };
}

export function trendingArticles(): Article[] {
  if (!site.trending.enabled) return [];
  return site.trending.slugs
    .map((slug) => getPublishedBySlug(slug))
    .filter((article): article is Article => Boolean(article));
}

export function readingMinutes(article: Article): number {
  const words = blockText(article.blocks).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

function blockText(blocks: ArticleBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "list") return block.items.join(" ");
      if (block.type === "code") return block.code;
      return block.text;
    })
    .join(" ");
}
