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
