import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_AUTOMATION_INPUT, automationInputSchema, type AutomationRecord } from "./automation.ts";
import { executeAutomation, isRetryable, type ExecuteInput, type PipelineDeps } from "./run.server.ts";

/**
 * End-to-end tests for the automation pipeline with injected dependencies: a
 * fake provider, a fake database and a fake publisher. These run the real code
 * path (config → topic → generate → validate → dedupe → save → publish) and
 * assert what the desk would report, without touching D1 or the network.
 */

const KEY = { AUTOMATION_A_KEY: "sk-test-key-not-real" };

function record(patch: Partial<AutomationRecord> = {}): AutomationRecord {
  const base = automationInputSchema.parse({
    ...DEFAULT_AUTOMATION_INPUT,
    name: "Pipeline test",
    enabled: true,
    mode: "server-api",
    provider: "openai",
    credentialRef: "AUTOMATION_A_KEY",
    topicIdeas: ["Edge inference in retail"],
    publishMode: "draft",
    // Keep the retry backoff out of the test run: the schedule is exercised in
    // the real pipeline, but a test must not sleep for a minute to prove it.
    retryMax: 0,
    retryBackoffSeconds: 10,
  });
  return { ...base, id: "pipe", sortOrder: 0, createdAt: "", updatedAt: "", ...patch };
}

const LONG_BODY = [
  "## What changed",
  "",
  "Small models are moving out of distant regions and into the building where the work happens. The shift is mundane on paper and awkward in practice, because every shelf-side machine needs a story about who updates it, who watches it and who turns it off.",
  "",
  "The first wave of deployments was about latency. A camera that recognises a pallet no longer waits for a round trip, so the loading bay stops stalling whenever the uplink wobbles.",
  "",
  "The second wave is about data residency. Retailers in several jurisdictions now prefer that footage and counts never leave the store, which turns a technical preference into a procurement requirement.",
  "",
  "## Why it matters",
  "",
  "Running inference on site changes the failure modes rather than removing them. A model that ages badly is no longer one bad deployment in a region; it is forty small deployments that nobody owns.",
  "",
  "- The hardware budget moves from the cloud account to the store fit-out.",
  "- The upgrade path becomes a logistics problem, not a software release.",
  "- The audit trail has to travel with the device.",
  "",
  "> The interesting question is no longer whether the model fits on the shelf. It is who is accountable when it drifts.",
  "",
  "None of this makes edge inference a mistake. It makes it an operational commitment, and the retailers getting value from it are the ones who priced that commitment before signing the invoice.",
].join("\n");

const ARTICLE = {
  title: "Edge inference moves into the stockroom",
  excerpt: "Retailers are running small models next to the shelves instead of in a distant region.",
  body: LONG_BODY,
  seo_title: "Edge inference in the stockroom",
  seo_description: "Why retailers are moving inference next to the shelves, and what it costs to keep it running.",
  tags: [],
  source_urls: ["https://example.org/report", "https://example.org/second-report"],
  image_prompt: "A stockroom shelf with a small server blinking",
  uncertain: false,
};

type Calls = { saved: unknown[]; published: string[]; logs: unknown[]; drafts: string[] };

function providerResponse(article: unknown = ARTICLE, status = 200): typeof fetch {
  return (async () =>
    new Response(
      status === 200
        ? JSON.stringify({ choices: [{ message: { content: JSON.stringify(article) } }] })
        : JSON.stringify({ error: { message: "server exploded" } }),
      { status, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
}

function deps(overrides: Partial<PipelineDeps> = {}): { deps: PipelineDeps; calls: Calls } {
  const calls: Calls = { saved: [], published: [], logs: [], drafts: [] };
  const base: PipelineDeps = {
    fetch: providerResponse(),
    recentTitles: async () => [],
    runIndex: async () => 0,
    categories: async () => [{ id: "news", slug: "news", label: "News" }],
    tags: async () => [],
    siteIdentity: async () => ({ name: "DYPOL Blog", description: "Field notes." }),
    saveDraft: async (input) => {
      calls.saved.push(input);
      return { id: "article-1", slug: input.slug };
    },
    uploadImage: async () => "media-1",
    attachCover: async () => {
      calls.drafts.push("cover");
    },
    publishDraft: async (articleId) => {
      calls.published.push(articleId);
      return true;
    },
    publishedToday: async () => 0,
    findDuplicate: async () => null,
    claimRun: async () => true,
    log: async (entry) => {
      calls.logs.push(entry);
    },
    setFlags: async () => undefined,
  };
  return { deps: { ...base, ...overrides }, calls };
}

const run = (patch: Partial<ExecuteInput> = {}, depOverrides: Partial<PipelineDeps> = {}) => {
  const built = deps(depOverrides);
  return {
    built,
    promise: executeAutomation({
      automation: record(),
      env: KEY,
      trigger: "manual",
      deps: built.deps,
      ...patch,
    } as ExecuteInput),
  };
};

test("dry run: reports what it would write and never touches the database", async () => {
  const { built, promise } = run({ dryRun: true });
  const outcome = await promise;
  assert.equal(outcome.status, "dry-run");
  assert.equal(outcome.published, false);
  assert.equal(built.calls.saved.length, 0, "nothing is saved in a dry run");
  assert.equal(built.calls.published.length, 0);
  assert.equal(outcome.preview?.title, ARTICLE.title);
  assert.ok((outcome.preview?.blocks ?? 0) > 0);
  assert.equal(built.calls.logs.length, 1, "the dry run is still auditable");
});

test("draft mode saves a draft, never publishes, and logs the run", async () => {
  const { built, promise } = run();
  const outcome = await promise;
  assert.equal(outcome.status, "draft");
  assert.equal(outcome.articleId, "article-1");
  assert.equal(built.calls.saved.length, 1);
  assert.equal(built.calls.published.length, 0);
  const saved = built.calls.saved[0] as { title: string; categoryId: string };
  assert.equal(saved.title, ARTICLE.title);
  assert.equal(saved.categoryId, "news");
  const log = built.calls.logs[0] as { status: string; tool: string };
  assert.equal(log.status, "draft");
  assert.equal(log.tool, "manual_run");
});

test("auto mode publishes when the checks pass, and only then", async () => {
  const ok = run({ automation: record({ publishMode: "auto", allowedCategoryIds: ["news"], minWords: 120 }) });
  const published = await ok.promise;
  assert.equal(published.status, "succeeded");
  assert.equal(published.published, true);
  assert.deepEqual(ok.built.calls.published, ["article-1"]);

  // Same automation, but the piece is shorter than the owner's minimum.
  const short = run(
    { automation: record({ publishMode: "auto", allowedCategoryIds: ["news"], minWords: 6000 }) },
  );
  const kept = await short.promise;
  assert.equal(kept.status, "draft");
  assert.equal(kept.published, false);
  assert.equal(short.built.calls.published.length, 0, "a flagged draft is never auto-published");
  assert.ok(kept.flags.includes("too_short"), `expected a too_short flag, got ${kept.flags.join(", ")}`);
});

test("a missing key fails at config with a clear reason and makes no request", async () => {
  let fetched = 0;
  const { promise } = run(
    { automation: record({ credentialRef: "AUTOMATION_B_KEY" }) },
    { fetch: (async () => {
      fetched += 1;
      return new Response("{}");
    }) as unknown as typeof fetch },
  );
  const outcome = await promise;
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.stage, "config");
  assert.match(outcome.reason, /AUTOMATION_B_KEY/);
  assert.equal(fetched, 0);
});

test("a provider failure is reported at the generate stage and classified for retry", async () => {
  const { promise } = run({}, { fetch: providerResponse(ARTICLE, 503) });
  const outcome = await promise;
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.stage, "generate");
  assert.match(outcome.reason, /503/);
  assert.equal(isRetryable(new Error("The provider answered 503.")), false, "plain errors are not retryable by class");
  assert.equal(isRetryable(new (await import("./provider.ts")).ProviderError("The provider answered 503.")), true);
  assert.equal(isRetryable(new (await import("./provider.ts")).ProviderError("The provider answered 401.")), false);
});

test("duplicate content is skipped instead of publishing twice", async () => {
  const { built, promise } = run({}, { findDuplicate: async () => ({ articleId: "article-9", matchedBy: "content_hash" }) });
  const outcome = await promise;
  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.articleId, "article-9");
  assert.match(outcome.reason, /already|duplicate|earlier|same/i);
  assert.equal(built.calls.saved.length, 0);
});

test("an MCP-driven automation is never run by the site", async () => {
  const { promise } = run({ automation: record({ mode: "mcp-connector", credentialRef: "" }) });
  const outcome = await promise;
  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.stage, "config");
  assert.match(outcome.reason, /MCP/);
});

test("the daily publishing limit and the repeat-topic guard both hold", async () => {
  const limited = run(
    { automation: record({ publishMode: "auto", allowedCategoryIds: ["news"], minWords: 120, maxPerDay: 1 }) },
    { publishedToday: async () => 1 },
  );
  const outcome = await limited.promise;
  assert.equal(outcome.published, false);

  const repeated = run({}, { recentTitles: async () => ["Edge inference in retail — what changed"] });
  const repeat = await repeated.promise;
  assert.equal(repeat.status, "skipped");
  assert.equal(repeat.stage, "topic");
  assert.equal(repeated.built.calls.saved.length, 0);
});

test("a malformed provider answer is refused before anything is written", async () => {
  const { built, promise } = run({}, { fetch: providerResponse({ title: "", excerpt: "", body: "" }) });
  const outcome = await promise;
  assert.equal(outcome.status, "failed");
  assert.ok(["generate", "validate"].includes(outcome.stage));
  assert.equal(built.calls.saved.length, 0);
});
