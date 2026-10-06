import type { ArticleBlock } from "./types.ts";

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "piece";
}

export function isSafeHref(value: string): boolean {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export function publishProblems(input: { excerpt: string; blocks: ArticleBlock[] }): string | null {
  if (!input.excerpt.trim()) return "Add an excerpt before publishing.";
  const hasBody = input.blocks.some((block) => {
    if (block.type === "list") return block.items.some((item) => item.trim());
    if (block.type === "code") return block.code.trim().length > 0;
    return block.text.trim().length > 0;
  });
  if (!hasBody) return "Add at least one block before publishing.";
  return null;
}
