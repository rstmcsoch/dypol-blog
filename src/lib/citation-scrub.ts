// t133: strip leftover AI citation markup (e.g. <grok type="render_inline_citation" .../>,
// [cite:..], 【..†..】) so it never renders as visible text. Leading spaces next to a
// removed tag go with it, so no stray double space or space-before-punctuation remains.
const ARTIFACT =
  /[ \t]*(?:<\/?grok\b[^>]*>|&lt;\/?grok\b[\s\S]*?&gt;|\[cite:[^\]]*\]|\[cite_(?:start|end)\]|【[^】]*†[^】]*】)/gi;

export function scrubCitations(text: string): string {
  if (!text || !/grok|cite|【/i.test(text)) return text;
  return text.replace(ARTIFACT, "").replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ");
}

/** Deep-clean every string in a value (blocks, article input). Code blocks are left untouched. */
export function scrubCitationsDeep<T>(value: T, key = ""): T {
  if (typeof value === "string") return (key === "code" ? value : scrubCitations(value)) as T;
  if (Array.isArray(value)) return value.map((v) => scrubCitationsDeep(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubCitationsDeep(v, k);
    return out as T;
  }
  return value;
}
