/**
 * t115: near-duplicate guard for automation submissions. A new story is a
 * near-duplicate of a recent one (last 14 days) when its title is very
 * similar (token Jaccard, ignoring stop words and punctuation) or it cites
 * one of the same source URLs. Pure, so it is unit-testable.
 */
const STOP = new Set(
  "a an and are as at be by for from has have in into is it its of on or that the this to with vs new now after over how why what its".split(" "),
);

export const NEAR_DUP_DAYS = 14;
export const TITLE_SIMILARITY = 0.6;

export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['’]s\b/g, "")
      .split(/[^a-z0-9.]+/)
      .map((t) => t.replace(/^\.+|\.+$/g, ""))
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

export function titleSimilarity(a: string, b: string): number {
  const x = titleTokens(a);
  const y = titleTokens(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared += 1;
  return shared / (x.size + y.size - shared);
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${path}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export type RecentStory = { id: string; slug: string; title: string; sourceUrls: string[] };
export type NearDuplicate = { story: RecentStory; reason: "title" | "sources"; score: number; sharedSources: string[] };

export function findNearDuplicate(candidate: { title: string; sourceUrls: string[] }, recent: RecentStory[]): NearDuplicate | null {
  const mine = new Set(candidate.sourceUrls.map(normalizeUrl).filter(Boolean));
  for (const story of recent) {
    const score = titleSimilarity(candidate.title, story.title);
    if (score >= TITLE_SIMILARITY) return { story, reason: "title", score, sharedSources: [] };
    const shared = story.sourceUrls.filter((u) => mine.has(normalizeUrl(u)));
    if (shared.length > 0) return { story, reason: "sources", score, sharedSources: shared };
  }
  return null;
}

export function nearDuplicateError(d: NearDuplicate): string {
  const why =
    d.reason === "title"
      ? `its title is ${Math.round(d.score * 100)}% similar to`
      : `it cites the same source${d.sharedSources.length > 1 ? "s" : ""} (${d.sharedSources.slice(0, 3).join(", ")}) as`;
  return `Near-duplicate rejected: ${why} “${d.story.title}” (/articles/${d.story.slug}, published in the last ${NEAR_DUP_DAYS} days). Update that article with update_article instead of filing a new one, or cover a genuinely different angle with a distinct title and sources.`;
}
