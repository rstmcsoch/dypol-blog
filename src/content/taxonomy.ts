import { CANONICAL_TOPICS } from "@/lib/topics";
import type { Category, Tag } from "./types";

/**
 * Seed taxonomy for a fresh database. The canonical topics (t44) ARE the
 * categories; production rows arrive via migration 0007. There are no
 * default tags any more — the owner can still create tags in the admin
 * panel, and articles keep whatever tags they already have.
 */
export const categories: Category[] = CANONICAL_TOPICS.map((t) => ({
  id: t.slug,
  slug: t.slug,
  label: t.label,
  description: t.description,
}));

export const tags: Tag[] = [];
