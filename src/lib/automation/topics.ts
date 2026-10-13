import type { AutomationRecord } from "./automation.ts";

/**
 * Topic selection. Pure and deterministic so it can be unit-tested and so a
 * retry picks the same topic as the attempt it is retrying.
 */

export type TopicChoice = { topic: string; sourceUrl: string | null; reason: string };

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** True when a title/topic almost certainly repeats something already published. */
export function looksDuplicate(topic: string, recentTitles: string[]): boolean {
  const needle = normalise(topic);
  if (!needle) return false;
  const words = needle.split(" ").filter((word) => word.length > 4);
  for (const title of recentTitles) {
    const haystack = normalise(title);
    if (haystack.includes(needle)) return true;
    // Keyword overlap: half of the meaningful words already used in one title.
    if (words.length >= 3) {
      const hits = words.filter((word) => haystack.includes(word)).length;
      if (hits >= Math.ceil(words.length / 2)) return true;
    }
  }
  return false;
}

/**
 * Pick the topic for this run.
 *
 * - `ideas`: the owner's list, skipping anything that repeats a recent title.
 * - `sources`: the owner's list, and the source sites are handed to the model
 *   for grounding (the site itself has no web search).
 * - `mixed`: the list first; if it is exhausted, fall back to a source site.
 * - `model`: no list — the model chooses, and the prompt forbids repeats.
 *
 * Returns null only when the configuration cannot produce a topic at all, which
 * the caller records as a `skipped` run (never as a failure).
 */
export function chooseTopic(input: {
  automation: Pick<AutomationRecord, "topicSource" | "topicIdeas" | "topicSources">;
  recentTitles: string[];
  /** How many runs this automation has already made (rotation offset). */
  runIndex: number;
}): TopicChoice | null {
  const { automation, recentTitles } = input;
  const ideas = automation.topicIdeas.map((idea) => idea.trim()).filter(Boolean);
  const sources = automation.topicSources.map((url) => url.trim()).filter(Boolean);
  const fresh = ideas.filter((idea) => !looksDuplicate(idea, recentTitles));
  const rotation = ideas.length > 0 ? ideas[input.runIndex % ideas.length] : undefined;

  switch (automation.topicSource) {
    case "ideas": {
      const topic = fresh[0] ?? rotation;
      return topic ? { topic, sourceUrl: null, reason: fresh[0] ? "next unused topic idea" : "topic ideas rotated" } : null;
    }
    case "sources": {
      const topic = fresh[0] ?? rotation;
      if (!topic) return null;
      return { topic, sourceUrl: sources[0] ?? null, reason: "topic idea, grounded on the listed source sites" };
    }
    case "mixed": {
      const topic = fresh[0] ?? rotation;
      if (topic) return { topic, sourceUrl: null, reason: "next unused topic idea" };
      if (sources.length > 0) return { topic: "", sourceUrl: sources[input.runIndex % sources.length] as string, reason: "topic list exhausted: writing from a source site" };
      return null;
    }
    case "model":
    default:
      return { topic: "", sourceUrl: null, reason: "the model chooses the topic" };
  }
}

/** A stable per-run key so retries never create a second article. */
export function runKey(automationId: string, scheduledFor: Date, attempt: number): string {
  const day = scheduledFor.toISOString().slice(0, 10);
  const time = scheduledFor.toISOString().slice(11, 16).replace(":", "");
  return `${automationId}-${day}-${time}-a${attempt}`;
}

/** Article slug candidate; the repository still de-duplicates. */
export function slugFromTitle(title: string): string {
  return title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}
