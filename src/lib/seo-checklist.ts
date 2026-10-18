/** Per-article SEO/readiness checklist for the editor (t68). Pure and testable. */
export type ChecklistItem = { label: string; ok: boolean; hint: string };

export function seoChecklist(input: {
  title: string;
  seoTitle: string;
  seoDescription: string;
  excerpt: string;
  slug: string;
  coverMediaId: string | null;
  topicCount: number;
  words: number;
  hasHeading: boolean;
}): ChecklistItem[] {
  const metaTitle = input.seoTitle || input.title;
  const items: ChecklistItem[] = [
    {
      label: "Title is clear (10–70 characters)",
      ok: input.title.trim().length >= 10 && input.title.trim().length <= 70,
      hint: `${input.title.trim().length} characters`,
    },
    {
      label: "Search title within 60 characters",
      ok: metaTitle.trim().length > 0 && metaTitle.trim().length <= 60,
      hint: input.seoTitle ? `${input.seoTitle.trim().length}/60 (custom)` : "Using the article title",
    },
    {
      label: "Search description written (120–160 characters)",
      ok: input.seoDescription.trim().length >= 120 && input.seoDescription.trim().length <= 160,
      hint: `${input.seoDescription.trim().length}/160`,
    },
    {
      label: "Excerpt written",
      ok: input.excerpt.trim().length >= 50,
      hint: `${input.excerpt.trim().length} characters`,
    },
    {
      label: "URL slug set",
      ok: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug.trim()),
      hint: input.slug || "Add a short lowercase slug",
    },
    {
      label: "Cover image chosen",
      ok: Boolean(input.coverMediaId),
      hint: input.coverMediaId ? "Cover set" : "No cover yet",
    },
    {
      label: "Filed under 1–4 topics",
      ok: input.topicCount >= 1 && input.topicCount <= 4,
      hint: `${input.topicCount} topic(s)`,
    },
    {
      label: "At least 600 words",
      ok: input.words >= 600,
      hint: `${input.words.toLocaleString()} words`,
    },
    {
      label: "Has a section heading",
      ok: input.hasHeading,
      hint: input.hasHeading ? "Heading found" : "Add a ## heading",
    },
  ];
  return items;
}

export function checklistScore(items: ChecklistItem[]): { passed: number; total: number } {
  return { passed: items.filter((i) => i.ok).length, total: items.length };
}
