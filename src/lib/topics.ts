/**
 * Canonical topics (t44). The blog's topics are stored as rows in the
 * `categories` table (the admin "Topics & tags" page manages them), and an
 * article can be filed under several at once via `article_topics`
 * (migration 0007). `articles.category_id` stays as the PRIMARY topic
 * (the first one) so every existing single-topic display keeps working.
 *
 * This module is the pure, testable core: the canonical 25, reference
 * resolution (id / slug / label, case-insensitive), legacy merging and
 * the pre-migration category mapping. Server code resolves references
 * against the live categories table, so topics the owner adds or renames
 * in the admin panel work without a code change.
 */

export type TopicDef = { slug: string; label: string; description: string };

/** Slug rules mirror `slugify` in content/rules (kept import-free for tests). */
export function topicSlug(label: string): string {
  const slug = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "piece";
}

const def = (label: string, description: string): TopicDef => ({ slug: topicSlug(label), label, description });

/** The 25 canonical topics. Each line Rustam gave is ONE topic, commas included. */
export const CANONICAL_TOPICS: TopicDef[] = [
  def("Artificial Intelligence & AI Tools", "AI models, assistants, agents and the tools built on them."),
  def("Smartphones, Android, iPhone & Wearables", "Phones, tablets, watches and the platforms they run."),
  def("Apps, Software & Operating Systems", "Applications, operating systems and everyday software."),
  def("Cybersecurity, Privacy", "Security threats, breaches, privacy and staying safe online."),
  def("Online Scams", "Fraud, phishing and scams people meet online, and how to spot them."),
  def("Big Tech Companies", "The largest technology companies and what they do next."),
  def("Competition", "Rivalries, market races and antitrust between tech companies."),
  def("Computer Hardware", "Computers, components, peripherals and how they are built."),
  def("Chips & Gaming", "Processors, graphics and the games industry."),
  def("Startups", "New companies, founders and early-stage technology."),
  def("Funding & Tech Business", "Investment, earnings, deals and the business of tech."),
  def("Social Media", "Social platforms, creators and online communities."),
  def("YouTube & Internet Culture", "Video, streaming, memes and how the internet lives."),
  def("Emerging Technology", "New technology that is still finding its shape."),
  def("Robotics & Science", "Robots, automation and the science behind them."),
  def("Technology Policy", "Laws, regulation and government decisions about technology."),
  def("Cloud Computing, Data Centers & Enterprise Tech", "Cloud platforms, data centers and technology at work."),
  def("Electric Vehicles", "Electric cars, batteries and charging."),
  def("Smart Mobility & Clean Technology", "New ways to move, and cleaner technology."),
  def("Product Reviews", "Hands-on reviews and verdicts on tech products."),
  def("Buying Guides", "What to buy, what to skip, and how to choose."),
  def("Developer Tools", "Tools, services and platforms for building software."),
  def("Coding & Open Source", "Programming, open source projects and developer life."),
  def("Tech News", "General technology news that fits nowhere else."),
  def("Leaks", "Credible leaks, rumours and early looks at unreleased tech."),
];

export const CANONICAL_TOPIC_SLUGS: string[] = CANONICAL_TOPICS.map((t) => t.slug);

/** How many topics one article may carry. The AI is told to pick 1–4. */
export const MAX_TOPICS_PER_ARTICLE = 4;

/**
 * Pre-migration category ids/slugs mapped to the closest canonical topic.
 * Used by migration 0007 (kept in sync there) and documented for the admin.
 * Anything not listed falls back to `tech-news`.
 */
export const LEGACY_TOPIC_MAP: Record<string, string> = {
  ai: "artificial-intelligence-ai-tools",
  "artificial-intelligence": "artificial-intelligence-ai-tools",
  systems: "developer-tools",
  design: "tech-news",
  publishing: "tech-news",
  notes: "tech-news",
};

export const FALLBACK_TOPIC_SLUG = "tech-news";

export type TopicLike = { id: string; slug: string; label: string };

function matches(topic: TopicLike, ref: string): boolean {
  const needle = ref.trim().toLowerCase();
  return topic.id.toLowerCase() === needle || topic.slug.toLowerCase() === needle || topic.label.toLowerCase() === needle;
}

export function resolveTopicRef(ref: string, available: TopicLike[]): TopicLike | undefined {
  return available.find((t) => matches(t, ref));
}

/** Resolves a list of references to ordered, de-duplicated topic ids. Unknown refs are reported, never dropped quietly. */
export function resolveTopicRefs(refs: string[], available: TopicLike[]): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const ref of refs) {
    const topic = resolveTopicRef(ref, available);
    if (!topic) {
      if (!unknown.includes(ref)) unknown.push(ref);
    } else if (!ids.includes(topic.id)) {
      ids.push(topic.id);
    }
  }
  return { ids, unknown };
}

/**
 * Merges the new `topics` array with the legacy single `category` field:
 * topics win and come first; a legacy category not already present is
 * appended. Either may be absent, but not both.
 */
export function mergeTopicRefs(input: { topics?: string[]; category?: string }, available: TopicLike[]): { ids: string[]; unknown: string[] } {
  const refs = [...(input.topics ?? []), ...(input.category ? [input.category] : [])];
  return resolveTopicRefs(refs, available);
}

/** Plain-English error for unknown topics, listing what IS valid so the caller can retry. */
export function unknownTopicsError(unknown: string[], available: TopicLike[]): string {
  return (
    `Unknown topic${unknown.length === 1 ? "" : "s"}: ${unknown.map((u) => `“${u}”`).join(", ")}. ` +
    `Use 1–${MAX_TOPICS_PER_ARTICLE} of the blog's topics (slug or exact name): ${available.map((t) => t.slug).join(", ")}.`
  );
}

/**
 * Publishing-policy allowlist, made safe for the topic migration: an empty
 * list means "all topics allowed", and a stored list naming only topics
 * that no longer exist (pre-migration ids) is also treated as "all", so
 * old profile settings can never silently block every new article.
 */
export function effectiveAllowedTopics(allowedCategoryIds: string[], existingTopicIds: string[]): string[] {
  if (allowedCategoryIds.length === 0) return [];
  const existing = new Set(existingTopicIds);
  const live = allowedCategoryIds.filter((id) => existing.has(id));
  return live.length > 0 ? live : [];
}
