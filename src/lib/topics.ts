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

/**
 * Per-topic filing guidance (t72): one disambiguating "file under X when…"
 * line per canonical topic, returned by get_blog_settings so the AI files
 * by content instead of defaulting to the first generic topic it sees.
 * Keyed by slug; topics the owner adds later fall back to their description.
 */
export const TOPIC_FILING_GUIDANCE: Record<string, string> = {
  "artificial-intelligence-ai-tools": "The article is mainly ABOUT an AI model, assistant, agent, or AI tool — its capabilities, release, or use. Not merely because AI is mentioned, and not when the main subject is a chip, a robot body, a quantum result, or a company's earnings.",
  "smartphones-android-iphone-wearables": "The main subject is a phone, tablet, watch, or their platforms (Android/iOS). A phone REVIEW also takes product-reviews; buying advice also takes buying-guides.",
  "apps-software-operating-systems": "The main subject is an app, program, or operating system release/feature — everyday software people run, not developer tooling.",
  "cybersecurity-privacy": "Security threats, breaches, malware, exploits, privacy, tracking, or staying safe online is a main subject — including AI-powered malware or self-replicating models.",
  "online-scams": "The main subject is a specific fraud/phishing/scam pattern and how readers spot or avoid it.",
  "big-tech-companies": "A giant tech company (Google, Apple, Microsoft, Amazon, Meta, NVIDIA…) and its strategy/moves is a main subject. Add it alongside the subject topic, e.g. a Google AI story is AI + Big Tech.",
  "competition": "The story is a rivalry, market-share race, or antitrust fight between companies.",
  "computer-hardware": "Computers and components themselves: PCs, laptops, GPUs as hardware, memory, peripherals, builds. If the angle is the chip industry/business, chips-gaming may fit better; often both.",
  "chips-gaming": "Processors/semiconductors (foundries, nodes, GPUs, AI accelerators as an industry) OR the games industry. Chip earnings/supply stories belong here with funding-tech-business.",
  "startups": "A young company, founder story, or early-stage venture is the main subject.",
  "funding-tech-business": "Money is a main subject: earnings, revenue, investment rounds, deals, market moves. Earnings reports belong here (plus the subject topic, e.g. chips).",
  "social-media": "A social platform, creator economy, or online community is the main subject.",
  "youtube-internet-culture": "Video/streaming culture, memes, or how the internet behaves is the main subject.",
  "emerging-technology": "A genuinely new technology still finding its shape is the main subject: quantum computing, novel computing paradigms, early-stage breakthroughs. The right home for a quantum result — not AI just because the lab is called an AI lab.",
  "robotics-science": "Robots, physical automation, or the underlying science is a main subject: humanoids, robot models, lab results. A robot foundation model is Robotics + AI.",
  "technology-policy": "Law, regulation, government or court decisions about technology are a main subject.",
  "cloud-computing-data-centers-enterprise-tech": "Cloud platforms, data centers, or workplace/enterprise infrastructure is a main subject — including sandboxing/isolation infrastructure that runs at scale.",
  "electric-vehicles": "Electric cars, batteries, or charging is the main subject.",
  "smart-mobility-clean-technology": "New transport or clean/green technology beyond EVs is the main subject.",
  "product-reviews": "A hands-on review or verdict on a specific product. Pair with the product's topic (phones, hardware…).",
  "buying-guides": "Advice on what to buy/skip and how to choose. Pair with the product's topic.",
  "developer-tools": "A tool, service, or platform FOR building software is the main subject: sandboxes, IDEs, APIs, infrastructure devs use. An open-source release for developers is Developer Tools + Coding & Open Source.",
  "coding-open-source": "Programming, an open-source project/release, or developer life is a main subject.",
  "tech-news": "LAST RESORT ONLY: general tech news that genuinely fits no other topic. If any other topic fits even partly, use that instead — never file under tech-news just to have a second topic, and never as the only topic when a subject topic fits.",
  "leaks": "A credible leak/rumour/early look at unreleased tech is the main subject.",
};

export function filingGuidance(slug: string, description = ""): string {
  return TOPIC_FILING_GUIDANCE[slug] ?? description;
}
