/**
 * t141: per-automation author names (bylines). Pure helpers, unit-tested.
 * Allowed: letters (any script), spaces, period, apostrophe, hyphen; 2-60 chars.
 */
export const AUTHOR_NAME_RE = /^[\p{L}][\p{L} .'\u2019-]*$/u;
export const FALLBACK_AUTHOR = "DYPOL LABS";

export type AuthorCheck = { ok: true; value: string | null } | { ok: false; error: string };

/** Empty input clears the author (null). Anything else must pass the rules. */
export function checkAuthorName(raw: unknown): AuthorCheck {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "Author name must be text." };
  const value = raw.replace(/\s+/g, " ").trim();
  if (!value) return { ok: true, value: null };
  if (/[<>&]/.test(value)) return { ok: false, error: "Author name can't contain HTML." };
  if (value.length < 2 || value.length > 60) return { ok: false, error: "Author name must be 2-60 characters." };
  if (!AUTHOR_NAME_RE.test(value)) return { ok: false, error: "Author name can use only letters, spaces and . ' -" };
  return { ok: true, value };
}

/** Case-insensitive comparison used for the one-author-per-profile rule. */
export function sameAuthor(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

/** Byline shown on the page: the stored author, else the publisher fallback. */
export function bylineName(authorName: string | null | undefined, fallback = FALLBACK_AUTHOR): string {
  const v = (authorName ?? "").trim();
  return v || fallback;
}

/**
 * Which author (if any) an MCP write should store on the article.
 * - create: the acting profile's author.
 * - update: only when the article has no author yet AND the acting profile
 *   is the one that created it (never stamp another profile's name).
 */
export function authorToAssign(input: { kind: "create" | "update"; currentAuthor: string | null | undefined; profileAuthor: string | null | undefined; actingProfileId: string; ownerProfileId: string | null }): string | null {
  const profileAuthor = (input.profileAuthor ?? "").trim();
  if (!profileAuthor) return null;
  if ((input.currentAuthor ?? "").trim()) return null;
  if (input.kind === "create") return profileAuthor;
  return input.ownerProfileId === input.actingProfileId ? profileAuthor : null;
}
