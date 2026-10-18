/**
 * How an automation profile picks its next topic. Pure helpers (tested);
 * the server persists only the sequence cursor (see automation.server).
 * Modes:
 *  - "ai-choice":  the AI picks freely (legacy/default).
 *  - "trend-first": the AI researches current trends first (no suggested
 *    topic from the server; trendSources say where to look).
 *  - "random":     server picks a random idea on each get_blog_settings.
 *  - "sequence":   server suggests ideas in order, advancing by `step`
 *    each time a draft actually uses one, wrapping around.
 */
export const TOPIC_SELECTION_MODES = ["ai-choice", "trend-first", "random", "sequence"] as const;
export type TopicSelectionMode = (typeof TOPIC_SELECTION_MODES)[number];
export const TREND_SOURCES = ["google-news", "web", "x", "social"] as const;
export type TrendSource = (typeof TREND_SOURCES)[number];
export const TOPIC_FALLBACKS = ["use-ideas", "ai-choice", "skip"] as const;
export type TopicFallback = (typeof TOPIC_FALLBACKS)[number];

export type TopicSelectionSettings = {
  mode: TopicSelectionMode;
  /** Sequence only: advance this many places after each used topic (1..20). */
  step: number;
  /** Trend-first only: where the AI should look for trends. */
  trendSources: TrendSource[];
  /** When the list (or trends) has nothing usable. */
  fallback: TopicFallback;
};

export const DEFAULT_TOPIC_SELECTION: TopicSelectionSettings = {
  mode: "ai-choice",
  step: 1,
  trendSources: ["google-news", "web"],
  fallback: "ai-choice",
};

export type TopicSelection = {
  mode: TopicSelectionMode;
  suggestedTopic: string | null;
  suggestedIndex: number | null;
  step: number;
  trendSources: TrendSource[];
  fallback: TopicFallback;
};

/** Cursor may point past the end after the owner edits/shortens the list. */
export function clampCursor(cursor: number, length: number): number {
  if (length <= 0) return 0;
  return ((Math.trunc(cursor) % length) + length) % length;
}

/** Next cursor after the idea at `usedIndex` was actually used. */
export function advanceCursor(usedIndex: number, step: number, length: number): number {
  if (length <= 0) return 0;
  return (clampCursor(usedIndex, length) + Math.max(1, Math.trunc(step))) % length;
}

export function computeTopicSelection(
  selection: TopicSelectionSettings,
  ideas: string[],
  cursor: number,
  random: () => number = Math.random,
): TopicSelection {
  const base = { mode: selection.mode, step: selection.step, trendSources: selection.trendSources, fallback: selection.fallback };
  if (selection.mode === "random") {
    if (ideas.length === 0) return { ...base, suggestedTopic: null, suggestedIndex: null };
    const index = Math.min(ideas.length - 1, Math.max(0, Math.floor(random() * ideas.length)));
    return { ...base, suggestedTopic: ideas[index], suggestedIndex: index };
  }
  if (selection.mode === "sequence") {
    if (ideas.length === 0) return { ...base, suggestedTopic: null, suggestedIndex: null };
    const index = clampCursor(cursor, ideas.length);
    return { ...base, suggestedTopic: ideas[index], suggestedIndex: index };
  }
  // trend-first and ai-choice: the AI chooses; the server suggests nothing.
  return { ...base, suggestedTopic: null, suggestedIndex: null };
}
