import { getSql } from "@/lib/db";
import { normalizeAutomationSettings, type AutomationSettings } from "@/lib/automation/settings";
import { ensureContent } from "./repository.server";

/** Storage for AI-connector automation: settings row, submissions (idempotency) and the run log. */

/** The legacy single-row record (site_settings 'automation'), if it exists. */
async function readLegacyRow(): Promise<AutomationSettings> {
  await ensureContent();
  const sql = await getSql();
  const rows = await sql<{ data: string }>`select data from site_settings where id = 'automation'`;
  const raw = rows[0]?.data;
  return normalizeAutomationSettings(typeof raw === "string" ? JSON.parse(raw) : raw);
}

/**
 * Settings for the MCP endpoint, resolved from the automation the desk marked
 * as the MCP default (the `automations` table).
 *
 * Consumers keep working unchanged, and nothing is lost on the way:
 *  - a database that still only has the legacy row returns that row;
 *  - `extraClientHosts` and `imageTransfer` are MCP-wide, so they keep coming
 *    from the legacy row;
 *  - everything else is the chosen automation's own settings, so two
 *    automations can no longer overwrite each other's provider or policy.
 */
export async function readAutomationSettings(): Promise<AutomationSettings> {
  const legacy = await readLegacyRow().catch(() => null);
  try {
    const { mcpAutomation } = await import("@/lib/automation/store.server");
    const record = await mcpAutomation();
    const base = legacy ?? normalizeAutomationSettings({});
    return {
      enabled: record.enabled,
      paused: record.paused,
      mode: record.mode,
      serverApi: { provider: record.provider, model: record.model, baseUrl: record.baseUrl },
      extraClientHosts: base.extraClientHosts,
      topicIdeas: record.topicIdeas,
      topicSources: record.topicSources,
      policy: {
        autoPublish: record.publishMode === "auto",
        allowedCategoryIds: record.allowedCategoryIds,
        minWords: record.minWords,
        requireSources: record.requireSources,
        minSources: record.minSources,
        requireFeaturedImage: record.requireCover,
        maxPublishedPerDay: record.maxPerDay,
      },
      imageTransfer: base.imageTransfer,
    };
  } catch {
    // No automations table yet (an older deployment) — the legacy row still runs
    // the endpoint exactly as before.
    return legacy ?? normalizeAutomationSettings({});
  }
}

export type RunRecord = {
  tool: string;
  outcome: string;
  reason?: string;
  articleId?: string | null;
  auth?: string;
  details?: Record<string, unknown>;
};

/** Best-effort audit log. Never throws; never stores credentials. */
export async function recordRun(run: RunRecord): Promise<string | null> {
  try {
    const sql = await getSql();
    const id = crypto.randomUUID();
    await sql`insert into automation_runs (id, created_at, tool, outcome, reason, article_id, auth, details)
      values (${id}, ${new Date().toISOString()}, ${run.tool}, ${run.outcome}, ${(run.reason ?? "").slice(0, 1000)},
        ${run.articleId ?? null}, ${run.auth ?? ""}, ${JSON.stringify(run.details ?? {}).slice(0, 4000)})`;
    return id;
  } catch (error) {
    console.error("[automation] could not record run", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

export type RunRow = {
  id: string;
  createdAt: string;
  tool: string;
  outcome: string;
  reason: string;
  articleId: string | null;
  auth: string;
};

/**
 * Reads recent runs from `automation_runs`. Does not swallow database errors so
 * a missing table or failed query is never mistaken for an empty run history.
 */
export async function recentRuns(limit = 20): Promise<RunRow[]> {
  const sql = await getSql();
  const rows = await sql<{ id: string; created_at: string; tool: string; outcome: string; reason: string; article_id: string | null; auth: string }>`
    select id, created_at, tool, outcome, reason, article_id, auth from automation_runs order by created_at desc limit ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    tool: r.tool,
    outcome: r.outcome,
    reason: r.reason,
    articleId: r.article_id,
    auth: r.auth,
  }));
}

export type Submission = {
  idempotencyKey: string;
  contentHash: string;
  articleId: string;
  sourceUrls: string[];
  flags: string[];
  provider: string;
  createdAt: string;
};

type SubmissionRow = {
  idempotency_key: string;
  content_hash: string;
  article_id: string;
  source_urls: string;
  flags: string;
  provider: string;
  created_at: string;
};

function toSubmission(r: SubmissionRow): Submission {
  return {
    idempotencyKey: r.idempotency_key,
    contentHash: r.content_hash,
    articleId: r.article_id,
    sourceUrls: JSON.parse(r.source_urls || "[]"),
    flags: JSON.parse(r.flags || "[]"),
    provider: r.provider,
    createdAt: r.created_at,
  };
}

export async function findSubmission(by: { key?: string; hash?: string; articleId?: string }): Promise<Submission | null> {
  const sql = await getSql();
  const rows = by.key
    ? await sql<SubmissionRow>`select * from automation_submissions where idempotency_key = ${by.key}`
    : by.hash
      ? await sql<SubmissionRow>`select * from automation_submissions where content_hash = ${by.hash} limit 1`
      : await sql<SubmissionRow>`select * from automation_submissions where article_id = ${by.articleId ?? ""} limit 1`;
  return rows[0] ? toSubmission(rows[0]) : null;
}

/** Inserts unless the key already exists; returns the winning row either way. */
export async function claimSubmission(s: Submission): Promise<Submission> {
  const sql = await getSql();
  await sql`insert or ignore into automation_submissions
    (idempotency_key, content_hash, article_id, source_urls, flags, provider, created_at)
    values (${s.idempotencyKey}, ${s.contentHash}, ${s.articleId}, ${JSON.stringify(s.sourceUrls)},
      ${JSON.stringify(s.flags)}, ${s.provider}, ${s.createdAt})`;
  return (await findSubmission({ key: s.idempotencyKey })) ?? s;
}

export async function setSubmissionFlags(articleId: string, flags: string[]): Promise<void> {
  const sql = await getSql();
  await sql`update automation_submissions set flags = ${JSON.stringify(flags)} where article_id = ${articleId}`;
}

export async function automatedPublishesToday(): Promise<number> {
  const sql = await getSql();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();
  const rows = await sql<{ n: number }>`select count(distinct r.article_id) as n from automation_runs r
    inner join articles a on a.id = r.article_id and a.status = 'published'
    where ((r.tool = 'publish_article_if_allowed' and r.outcome = 'published') or (r.status = 'succeeded' and r.outcome = 'succeeded'))
      and r.created_at >= ${sinceIso}`;
  return Number(rows[0]?.n ?? 0);
}
