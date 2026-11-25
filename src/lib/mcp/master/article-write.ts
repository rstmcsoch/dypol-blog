/**
 * Build a complete `articleWriteSchema` payload for Master MCP creates.
 * The editor schema requires fields (id, categoryId, tagIds, motif,
 * publishedAt) that the Master tool's public input omits.
 */
const MOTIFS = ["corner", "band", "split", "stamp", "stack", "edge"] as const;

export function pickMotif(seed: string): (typeof MOTIFS)[number] {
  let n = 0;
  for (let i = 0; i < seed.length; i++) n = (n + seed.charCodeAt(i)) % MOTIFS.length;
  return MOTIFS[n];
}

export function masterNewArticleWrite(input: {
  title: string;
  slug?: string;
  excerpt?: string;
  topicIds: string[];
  tagIds?: string[];
  seoTitle?: string;
  seoDescription?: string;
  authorName?: string;
  featured?: boolean;
  coverMediaId?: string | null;
  blocks: unknown[];
  intent: "save" | "publish";
  motif?: (typeof MOTIFS)[number];
}) {
  const topicIds = [...new Set(input.topicIds.filter(Boolean))].slice(0, 4);
  if (!topicIds[0]) throw new Error("Provide at least one topic_id from the site's topic list.");
  return {
    id: null,
    title: input.title,
    slug: input.slug ?? "",
    excerpt: input.excerpt ?? "",
    categoryId: topicIds[0],
    topicIds,
    tagIds: input.tagIds ?? [],
    motif: input.motif ?? pickMotif(input.title),
    featured: input.featured ?? false,
    seoTitle: input.seoTitle ?? "",
    seoDescription: (input.seoDescription ?? "").slice(0, 300),
    coverMediaId: input.coverMediaId ?? null,
    publishedAt: null,
    authorName: input.authorName,
    blocks: input.blocks,
    intent: input.intent,
  };
}

export function masterExistingArticleWrite(
  article: Record<string, unknown>,
  overrides: {
    title?: string;
    slug?: string;
    excerpt?: string;
    topicIds?: string[];
    tagIds?: string[];
    seoTitle?: string;
    seoDescription?: string;
    authorName?: string;
    featured?: boolean;
    coverMediaId?: string | null;
    scheduledAt?: string | null;
    corrections?: string | null;
    blocks?: unknown[];
  } = {},
  intent: "save" | "publish" | "unpublish" = "save",
) {
  const rawTopics = overrides.topicIds ?? (Array.isArray(article.topicIds) ? (article.topicIds as string[]) : []);
  const existingCat = typeof article.categoryId === "string" && article.categoryId.trim() ? article.categoryId.trim() : "";
  const topicIds = [...new Set([...rawTopics, ...(rawTopics.length === 0 && existingCat ? [existingCat] : [])].filter((v): v is string => typeof v === "string" && v.trim().length > 0))].slice(0, 4);
  const categoryId = topicIds[0] || existingCat;
  if (!categoryId) throw new Error("Article has no topic/categoryId. Pass topic_ids with at least one valid topic.");
  const title = overrides.title ?? (typeof article.title === "string" ? article.title : "");
  const rawMotif = typeof article.motif === "string" ? article.motif : "";
  const motif = (MOTIFS as readonly string[]).includes(rawMotif) ? (rawMotif as (typeof MOTIFS)[number]) : pickMotif(title || String(article.id ?? ""));
  const rawCorrections = overrides.corrections !== undefined ? overrides.corrections : article.corrections;
  const corrections = typeof rawCorrections === "string" ? rawCorrections : "";
  const rawTagIds = overrides.tagIds ?? (Array.isArray(article.tagIds) ? (article.tagIds as string[]) : []);
  const tagIds = [...new Set(rawTagIds.filter((v): v is string => typeof v === "string" && v.trim().length > 0))].slice(0, 24);
  const seoTitle = overrides.seoTitle ?? (typeof article.seoTitle === "string" ? article.seoTitle : "");
  const seoDescription = (overrides.seoDescription ?? (typeof article.seoDescription === "string" ? article.seoDescription : "")).slice(0, 300);
  const coverMediaId = overrides.coverMediaId !== undefined
    ? overrides.coverMediaId
    : (typeof article.coverMediaId === "string" && article.coverMediaId.trim() ? article.coverMediaId : null);
  const publishedAt = typeof article.publishedAt === "string" && article.publishedAt.trim() ? article.publishedAt : null;
  const scheduledAt = overrides.scheduledAt !== undefined
    ? overrides.scheduledAt
    : (typeof article.scheduledAt === "string" && article.scheduledAt.trim() ? article.scheduledAt : null);
  const authorName = overrides.authorName !== undefined
    ? overrides.authorName
    : (typeof article.authorName === "string" ? article.authorName : undefined);
  return {
    id: typeof article.id === "string" ? article.id : null,
    title,
    slug: overrides.slug ?? (typeof article.slug === "string" ? article.slug : ""),
    excerpt: overrides.excerpt ?? (typeof article.excerpt === "string" ? article.excerpt : ""),
    categoryId,
    topicIds: topicIds.length ? topicIds : [categoryId],
    tagIds,
    motif,
    featured: overrides.featured ?? Boolean(article.featured),
    seoTitle,
    seoDescription,
    coverMediaId,
    publishedAt,
    ...(scheduledAt !== null ? { scheduledAt } : {}),
    corrections,
    ...(authorName !== undefined ? { authorName } : {}),
    blocks: overrides.blocks ?? (Array.isArray(article.blocks) ? article.blocks : []),
    intent,
  };
}
