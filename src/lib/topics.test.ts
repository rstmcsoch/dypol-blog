import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CANONICAL_TOPICS,
  CANONICAL_TOPIC_SLUGS,
  LEGACY_TOPIC_MAP,
  effectiveAllowedTopics,
  mergeTopicRefs,
  resolveTopicRefs,
  topicSlug,
  unknownTopicsError,
} from "./topics.ts";

const available = CANONICAL_TOPICS.map((t) => ({ id: t.slug, slug: t.slug, label: t.label }));

test("canonical list: exactly 25 topics, unique slugs that match slugify(label)", () => {
  assert.equal(CANONICAL_TOPICS.length, 25);
  assert.equal(new Set(CANONICAL_TOPIC_SLUGS).size, 25);
  for (const t of CANONICAL_TOPICS) assert.equal(t.slug, topicSlug(t.label), t.label);
  // Spot-check the comma-containing names survive as ONE topic each.
  assert.ok(CANONICAL_TOPIC_SLUGS.includes("smartphones-android-iphone-wearables"));
  assert.ok(CANONICAL_TOPIC_SLUGS.includes("cloud-computing-data-centers-enterprise-tech"));
  assert.ok(CANONICAL_TOPIC_SLUGS.includes("cybersecurity-privacy"));
  assert.ok(CANONICAL_TOPIC_SLUGS.includes("artificial-intelligence-ai-tools"));
  assert.ok(CANONICAL_TOPIC_SLUGS.includes("youtube-internet-culture"));
});

test("resolution accepts slug, id and exact label, case-insensitively", () => {
  const { ids, unknown } = resolveTopicRefs(["tech-news", "Leaks", "ARTIFICIAL INTELLIGENCE & AI TOOLS", " tech-news "], available);
  assert.deepEqual(ids, ["tech-news", "leaks", "artificial-intelligence-ai-tools"]);
  assert.deepEqual(unknown, []);
});

test("unknown topics are reported, not dropped", () => {
  const { ids, unknown } = resolveTopicRefs(["tech-news", "Cooking", "gardening"], available);
  assert.deepEqual(ids, ["tech-news"]);
  assert.deepEqual(unknown, ["Cooking", "gardening"]);
  const msg = unknownTopicsError(unknown, available);
  assert.match(msg, /Cooking/);
  assert.match(msg, /tech-news/); // lists valid topics for a retry
});

test("legacy single category merges into topics (topics first, no duplicates)", () => {
  assert.deepEqual(mergeTopicRefs({ category: "Leaks" }, available).ids, ["leaks"]);
  assert.deepEqual(mergeTopicRefs({ topics: ["Tech News"] }, available).ids, ["tech-news"]);
  assert.deepEqual(mergeTopicRefs({ topics: ["Leaks"], category: "Tech News" }, available).ids, ["leaks", "tech-news"]);
  assert.deepEqual(mergeTopicRefs({ topics: ["Leaks"], category: "leaks" }, available).ids, ["leaks"]);
  assert.deepEqual(mergeTopicRefs({}, available).ids, []);
});

test("legacy map only points at canonical topics", () => {
  for (const target of Object.values(LEGACY_TOPIC_MAP)) assert.ok(CANONICAL_TOPIC_SLUGS.includes(target), target);
});

test("allowlist: empty = all; stale pre-migration ids = all; live ids respected", () => {
  assert.deepEqual(effectiveAllowedTopics([], ["tech-news"]), []);
  assert.deepEqual(effectiveAllowedTopics(["ai", "systems"], ["tech-news", "leaks"]), []);
  assert.deepEqual(effectiveAllowedTopics(["ai", "tech-news"], ["tech-news", "leaks"]), ["tech-news"]);
});
