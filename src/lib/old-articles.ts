import type { Article, PublicationStatus } from "../content/types.ts";

/**
 * "Delete old articles" rules (admin only — never exposed to MCP/AI).
 *
 * Age basis, stated plainly in the UI: an article's date is its publish date
 * when published, otherwise its last-saved date (articles have no separate
 * created-at; updated_at is the honest date we have). An article matches
 * when its date is strictly BEFORE the cutoff — an article exactly at the
 * cutoff (e.g. exactly 1 week old) is NOT deleted.
 */
export const OLD_ARTICLE_SCOPES = ["drafts-unpublished", "drafts", "unpublished", "published", "all"] as const;
export type OldArticleScope = (typeof OLD_ARTICLE_SCOPES)[number];
export const AGE_PRESETS = ["week", "month", "3months", "custom"] as const;
export type AgePreset = (typeof AGE_PRESETS)[number];

export type OldArticleQuery = { preset: AgePreset; customDays?: number; scope: OldArticleScope };

export function parseOldArticleQuery(input: unknown): OldArticleQuery {
  const v = (input ?? {}) as { preset?: unknown; customDays?: unknown; scope?: unknown };
  if (!(AGE_PRESETS as readonly unknown[]).includes(v.preset)) throw new Error("Choose an age: 1 week, 1 month, 3 months, or custom days.");
  if (!(OLD_ARTICLE_SCOPES as readonly unknown[]).includes(v.scope)) throw new Error("Choose which articles to include.");
  let customDays: number | undefined;
  if (v.preset === "custom") {
    customDays = typeof v.customDays === "number" ? v.customDays : Number(v.customDays);
    if (!Number.isInteger(customDays) || customDays < 1 || customDays > 3650) throw new Error("Custom age must be a whole number of days between 1 and 3650.");
  }
  return { preset: v.preset as AgePreset, customDays, scope: v.scope as OldArticleScope };
}

/** The moment before which articles count as "old". Calendar months for month presets. */
export function cutoffFor(query: OldArticleQuery, now: Date): Date {
  const cutoff = new Date(now);
  if (query.preset === "week") cutoff.setDate(cutoff.getDate() - 7);
  else if (query.preset === "month") cutoff.setMonth(cutoff.getMonth() - 1);
  else if (query.preset === "3months") cutoff.setMonth(cutoff.getMonth() - 3);
  else cutoff.setDate(cutoff.getDate() - (query.customDays ?? 30));
  return cutoff;
}

export function articleDate(article: Pick<Article, "status" | "publishedAt" | "updatedAt">): { iso: string; basis: "published" | "last saved" } {
  if (article.status === "published" && article.publishedAt) return { iso: article.publishedAt, basis: "published" };
  return { iso: article.updatedAt, basis: "last saved" };
}

export function scopeIncludes(scope: OldArticleScope, status: PublicationStatus): boolean {
  if (scope === "all") return true;
  if (scope === "drafts-unpublished") return status === "draft" || status === "unpublished";
  if (scope === "drafts") return status === "draft";
  if (scope === "unpublished") return status === "unpublished";
  return status === "published";
}

export type OldArticleMatch = { id: string; slug: string; title: string; status: PublicationStatus; dateIso: string; basis: "published" | "last saved" };

/** Articles in scope whose date is strictly before the cutoff, oldest first. */
export function filterOldArticles(articles: Article[], query: OldArticleQuery, now: Date): OldArticleMatch[] {
  const cutoff = cutoffFor(query, now).getTime();
  return articles
    .filter((a) => scopeIncludes(query.scope, a.status))
    .map((a) => ({ article: a, ...articleDate(a) }))
    .filter(({ iso }) => new Date(iso).getTime() < cutoff)
    .sort((x, y) => new Date(x.iso).getTime() - new Date(y.iso).getTime())
    .map(({ article, iso, basis }) => ({ id: article.id, slug: article.slug, title: article.title, status: article.status, dateIso: iso, basis }));
}
