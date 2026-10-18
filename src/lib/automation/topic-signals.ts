/**
 * t72 deterministic topic signals (NOT machine learning): a small lexicon of
 * strong content signals per topic, counted over title (x3) + excerpt (x2) +
 * body (x1). Used only ADVISORILY: when an article is filed under a single
 * topic while other topics score strongly, the submission is flagged
 * `topic_review` (blocks auto-publish, owner checks) and the response
 * suggests the missing topics. The server never auto-assigns topics.
 */

type Lex = { slug: string; terms: string[] };

const L = (slug: string, terms: string[]): Lex => ({ slug, terms });

export const TOPIC_SIGNAL_LEXICON: Lex[] = [
  L("emerging-technology", ["quantum", "qubit", "magic state", "fault-tolerant", "superconducting", "photonics breakthrough", "neuromorphic", "brain-computer interface", "fusion energy", "solid-state battery breakthrough"]),
  L("robotics-science", ["robot", "humanoid", "actuator", "gripper", "robotics", "autonomous vehicle test", "drone swarm", "exoskeleton", "physical ai"]),
  L("cybersecurity-privacy", ["malware", "botnet", "ransomware", "phishing", "vulnerability", "exploit", "data breach", "self-replicat", "zero-day", "spyware", "credential stuffing", "privacy policy change", "tracking cookies"]),
  L("chips-gaming", ["semiconductor", "foundry", "tsmc", "wafer", "nanometer", "3nm", "2nm", "5nm", "7nm", "gpu", "accelerator", "playstation", "xbox", "nintendo", "steam deck", "game studio"]),
  L("computer-hardware", ["laptop", "motherboard", "ram", "ssd", "peripheral", "keyboard", "monitor", "pc build", "graphics card", "cpu benchmark", "cooling"]),
  L("funding-tech-business", ["revenue", "earnings", "quarterly profit", "net income", "funding round", "series a", "series b", "series c", "valuation", "acquisition", "ipo", "market cap", "shares rose", "investors"]),
  L("big-tech-companies", ["google", "microsoft", "apple", "amazon", "meta", "nvidia", "openai", "anthropic", "samsung electronics"]),
  L("developer-tools", ["sandbox", "microvm", "firecracker", "api", "sdk", "ide", "compiler", "runtime environment", "developer platform", "code execution", "kubernetes", "docker"]),
  L("coding-open-source", ["open source", "open-source", "github", "apache 2.0", "mit license", "programming language", "pull request", "repository", "rust crate", "npm package"]),
  L("cloud-computing-data-centers-enterprise-tech", ["data center", "data centre", "cloud platform", "hyperscaler", "server fleet", "enterprise software", "saas", "colocation", "power capacity", "cooling capacity"]),
  L("smartphones-android-iphone-wearables", ["iphone", "android phone", "pixel phone", "galaxy phone", "smartwatch", "wearable", "foldable phone", "smartphone"]),
  L("apps-software-operating-systems", ["operating system", "windows 12", "macos", "ios 2", "android 1", "app update", "software update", "browser update"]),
  L("product-reviews", ["review", "hands-on", "verdict", "benchmark results", "we tested", "pros and cons"]),
  L("buying-guides", ["buying guide", "best phone", "best laptop", "should you buy", "deal", "discount", "vs comparison", "which to buy"]),
  L("social-media", ["instagram", "tiktok", "facebook", "social media", "creators", "followers", "viral post"]),
  L("youtube-internet-culture", ["youtube", "streamer", "streaming", "meme", "viral video", "internet culture"]),
  L("technology-policy", ["regulation", "regulator", "antitrust", "lawmakers", "court ruled", "ban", "eu commission", "ftc", "data protection law", "parliament"]),
  L("competition", ["market share", "rival", "competing", "race to", "undercut", "switching cost", "moat"]),
  L("startups", ["startup", "founded in", "early-stage", "seed round", "founder"]),
  L("electric-vehicles", ["electric vehicle", "ev battery", "charging network", "electric car", "tesla model", "range miles"]),
  L("smart-mobility-clean-technology", ["e-bike", "scooter", "solar panel", "wind turbine", "carbon capture", "clean energy", "heat pump"]),
  L("online-scams", ["scam", "fraudsters", "phishing message", "fake invoice", "romance scam", "pig butchering"]),
  L("leaks", ["leak", "leaked", "rumour", "rumor", "unannounced", "spotted in code", "early look"]),
  L("artificial-intelligence-ai-tools", ["ai model", "large language model", "llm", "chatbot", "ai assistant", "ai agent", "machine learning", "neural network", "ai tools"]),
  L("tech-news", []),
];

export type TopicSignal = { slug: string; score: number; matched: string[] };

export function topicSignals(input: { title: string; excerpt?: string; body: string }, filedSlugs: string[]): { suggestedMissing: TopicSignal[]; reviewNeeded: boolean } {
  const title = input.title.toLowerCase();
  const excerpt = (input.excerpt ?? "").toLowerCase();
  const body = input.body.toLowerCase().slice(0, 60_000);
  const filed = new Set(filedSlugs);
  const scored: TopicSignal[] = [];
  for (const lex of TOPIC_SIGNAL_LEXICON) {
    if (!lex.terms.length || filed.has(lex.slug)) continue;
    let score = 0;
    const matched: string[] = [];
    for (const term of lex.terms) {
      const inTitle = title.includes(term) ? 1 : 0;
      const inExcerpt = excerpt.includes(term) ? 1 : 0;
      const bodyHits = Math.min(3, body.split(term).length - 1);
      const s = inTitle * 3 + inExcerpt * 2 + bodyHits;
      if (s > 0) matched.push(term);
      score += s;
    }
    // Strong = at least two distinct signals, or one signal repeated across fields.
    if (score >= 5 && matched.length >= 2) scored.push({ slug: lex.slug, score, matched: matched.slice(0, 4) });
    else if (score >= 8) scored.push({ slug: lex.slug, score, matched: matched.slice(0, 4) });
  }
  scored.sort((a, b) => b.score - a.score);
  const suggestedMissing = scored.slice(0, 3);
  return { suggestedMissing, reviewNeeded: filedSlugs.length <= 1 && suggestedMissing.length > 0 };
}
