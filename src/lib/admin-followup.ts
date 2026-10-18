/**
 * t69 follow-up helpers (pure): 404 path sanitising, activity-feed merging,
 * and building the save-input that restores an article revision.
 * Restoring never changes publish status or slug — saveArticle keeps the
 * current row's status/slug when the input carries the current slug.
 */

export const REVISION_KEEP = 20;

export function sanitizeNotFoundPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let path = raw.trim();
  if (!path.startsWith("/")) return null;
  path = path.split(/[?#]/)[0] ?? "/";
  if (path.length > 300) path = path.slice(0, 300);
  if (path === "/api/not-found") return null;
  return path || "/";
}

export type ActivityEntry = { at: string; source: "You" | "Automation"; text: string };

export function mergeActivityFeed(
  admin: Array<{ at: string; text: string }>,
  automation: Array<{ at: string; text: string }>,
  limit = 50,
): ActivityEntry[] {
  const all: ActivityEntry[] = [
    ...admin.map((a) => ({ at: a.at, source: "You" as const, text: a.text })),
    ...automation.map((a) => ({ at: a.at, source: "Automation" as const, text: a.text })),
  ];
  all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return all.slice(0, Math.max(1, Math.min(limit, 100)));
}

export type RevisionSnapshot = {
  v: 1;
  title: string;
  excerpt: string;
  categoryId: string;
  topicIds: string[];
  tagIds: string[];
  motif: string;
  featured: boolean;
  seoTitle: string;
  seoDescription: string;
  coverMediaId: string;
  blocks: unknown[];
  scheduledAt: string | null;
};

/** Save-input for saveArticle that restores snapshot content into the current article. */
export function buildRestoreInput(articleId: string, currentSlug: string, snap: RevisionSnapshot): Record<string, unknown> {
  return {
    id: articleId,
    slug: currentSlug,
    title: snap.title,
    excerpt: snap.excerpt,
    categoryId: snap.categoryId,
    topicIds: snap.topicIds,
    tagIds: snap.tagIds,
    motif: snap.motif,
    featured: snap.featured,
    coverMediaId: snap.coverMediaId,
    seoTitle: snap.seoTitle,
    seoDescription: snap.seoDescription,
    blocks: Array.isArray(snap.blocks) ? snap.blocks : [],
    scheduledAt: snap.scheduledAt,
  };
}
