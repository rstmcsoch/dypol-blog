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
  /** t91 Phase 4 (advisory only, never a publish gate). When supplied,
   * three engineer-report checks are appended. */
  linkCount?: number;
  hasTakeawayOrTable?: boolean;
  hasReaderActionHeading?: boolean;
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
  if (input.linkCount !== undefined) {
    items.push(
      {
        label: "Sources linked in the text (not just listed)",
        ok: input.linkCount >= 1,
        hint: input.linkCount >= 1 ? `${input.linkCount} link(s) in the body` : "Link the primary source beside the claim: [label](https://…)",
      },
      {
        label: "At a glance box or a table (longer pieces)",
        ok: input.hasTakeawayOrTable === true || input.words < 600,
        hint: input.hasTakeawayOrTable ? "Found" : input.words < 600 ? "Optional under 600 words" : "Add an 'At a glance' list or a comparison table",
      },
      {
        label: "Says what it means for the reader / what to do",
        ok: input.hasReaderActionHeading === true,
        hint: input.hasReaderActionHeading ? "Heading found" : "Add a heading like 'What this means for you' or 'What to do now' when the story has a reader action",
      },
    );
  }
  return items;
}

export function checklistScore(items: ChecklistItem[]): { passed: number; total: number } {
  return { passed: items.filter((i) => i.ok).length, total: items.length };
}
