import { getSql, type Sql } from "@/lib/db";
import { workerEnv } from "@/lib/cf-env.server";
import {
  automationIdFromName,
  automationInputSchema,
  DEFAULT_AUTOMATION_INPUT,
  type AutomationInput,
  type AutomationRecord,
} from "./automation";
import { normalizeAutomationSettings, type AutomationSettings } from "./settings";

/**
 * Persistence for independent automations: definitions, durable schedule state,
 * rich run history and the view metric.
 *
 * The legacy single-row configuration (site_settings id 'automation') is read
 * once and turned into the first automation row; nothing is deleted, so an
 * older deployment keeps working after the upgrade.
 */

type AutomationRow = {
  id: string;
  name: string;
  enabled: number;
  paused: number;
  mode: string;
  provider: string;
  model: string;
  base_url: string;
  credential_ref: string;
  topic_source: string;
  topic_ideas: string;
  topic_sources: string;
  category_id: string | null;
  tag_ids: string;
  language: string;
  style: string;
  instructions: string;
  min_words: number;
  image_mode: string;
  image_prompt: string;
  publish_mode: string;
  schedule_cron: string;
  timezone: string;
  max_per_day: number;
  retry_max: number;
  retry_backoff_seconds: number;
  require_sources: number;
  min_sources: number;
  require_cover: number;
  allowed_category_ids: string;
  mcp_default: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

function jsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toRecord(row: AutomationRow): AutomationRecord {
  const candidate = {
    name: row.name,
    enabled: Boolean(row.enabled),
    paused: Boolean(row.paused),
    mode: row.mode,
    provider: row.provider,
    model: row.model,
    baseUrl: row.base_url,
    credentialRef: row.credential_ref,
    topicSource: row.topic_source,
    topicIdeas: jsonArray(row.topic_ideas),
    topicSources: jsonArray(row.topic_sources),
    categoryId: row.category_id,
    tagIds: jsonArray(row.tag_ids),
    language: row.language,
    style: row.style,
    instructions: row.instructions,
    minWords: Number(row.min_words),
    imageMode: row.image_mode,
    imagePrompt: row.image_prompt,
    publishMode: row.publish_mode,
    scheduleCron: row.schedule_cron,
    timezone: row.timezone,
    maxPerDay: Number(row.max_per_day),
    retryMax: Number(row.retry_max),
    retryBackoffSeconds: Number(row.retry_backoff_seconds),
    requireSources: Boolean(row.require_sources),
    minSources: Number(row.min_sources),
    requireCover: Boolean(row.require_cover),
    allowedCategoryIds: jsonArray(row.allowed_category_ids),
    mcpDefault: Boolean(row.mcp_default),
  };
  const input = parseRecord(candidate, row.name);
  return {
    ...input,
    id: row.id,
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Validates a stored row. A row that fails validation keeps everything that is
 * still valid: dropping the offending field back to its default is far less
 * surprising than silently turning the whole automation off and losing the
 * owner's settings (for example after a schema gains a new rule).
 */
function parseRecord(candidate: Record<string, unknown>, name: string): AutomationInput {
  const parsed = automationInputSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  console.warn("[automation] stored settings need attention; keeping the valid fields", {
    problems: parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`),
  });
  const working: Record<string, unknown> = { ...candidate };
  // Take the first default for each failing top-level field, then re-validate.
  const failing = [...new Set(parsed.error.issues.map((issue) => issue.path[0]).filter((key): key is string => typeof key === "string"))];
  for (const key of failing) {
    if (key in DEFAULT_AUTOMATION_INPUT) working[key] = (DEFAULT_AUTOMATION_INPUT as Record<string, unknown>)[key];
  }
  const retry = automationInputSchema.safeParse({ ...DEFAULT_AUTOMATION_INPUT, ...working });
  if (retry.success) return retry.data;
  return { ...DEFAULT_AUTOMATION_INPUT, name: name || DEFAULT_AUTOMATION_INPUT.name, enabled: false, paused: true };
}

const COLUMNS = `id, name, enabled, paused, mode, provider, model, base_url, credential_ref, topic_source,
  topic_ideas, topic_sources, category_id, tag_ids, language, style, instructions, min_words, image_mode,
  image_prompt, publish_mode, schedule_cron, timezone, max_per_day, retry_max, retry_backoff_seconds,
  require_sources, min_sources, require_cover, allowed_category_ids, mcp_default, sort_order, created_at, updated_at`;

async function selectAll(sql: Sql): Promise<AutomationRecord[]> {
  const rows = await sql.query<AutomationRow>(`select ${COLUMNS} from automations order by sort_order asc, created_at asc`);
  return rows.map(toRecord);
}

/** The old global record, if the deployment predates per-automation settings. */
async function legacySettings(sql: Sql): Promise<AutomationSettings | null> {
  try {
    const rows = await sql<{ data: string }>`select data from site_settings where id = 'automation'`;
    const raw = rows[0]?.data;
    if (raw === undefined) return null;
    return normalizeAutomationSettings(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch {
    return null;
  }
}

function inputFromLegacy(settings: AutomationSettings): AutomationInput {
  return {
    ...DEFAULT_AUTOMATION_INPUT,
    name: "Primary automation",
    enabled: settings.enabled,
    paused: settings.paused,
    mode: settings.mode,
    provider: settings.serverApi.provider,
    model: settings.serverApi.model,
    baseUrl: settings.serverApi.baseUrl,
    credentialRef: "",
    topicIdeas: settings.topicIdeas,
    topicSources: settings.topicSources,
    minWords: settings.policy.minWords,
    publishMode: settings.policy.autoPublish ? "auto" : "draft",
    maxPerDay: settings.policy.maxPublishedPerDay,
    requireSources: settings.policy.requireSources,
    minSources: settings.policy.minSources,
    requireCover: settings.policy.requireFeaturedImage,
    allowedCategoryIds: settings.policy.allowedCategoryIds,
    mcpDefault: true,
  };
}

async function insert(sql: Sql, id: string, input: AutomationInput, sortOrder: number): Promise<void> {
  const now = new Date().toISOString();
  await sql.run(
    `insert into automations (${COLUMNS})
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.enabled ? 1 : 0,
      input.paused ? 1 : 0,
      input.mode,
      input.provider,
      input.model,
      input.baseUrl,
      input.credentialRef,
      input.topicSource,
      JSON.stringify(input.topicIdeas),
      JSON.stringify(input.topicSources),
      input.categoryId,
      JSON.stringify(input.tagIds),
      input.language,
      input.style,
      input.instructions,
      input.minWords,
      input.imageMode,
      input.imagePrompt,
      input.publishMode,
      input.scheduleCron,
      input.timezone,
      input.maxPerDay,
      input.retryMax,
      input.retryBackoffSeconds,
      input.requireSources ? 1 : 0,
      input.minSources,
      input.requireCover ? 1 : 0,
      JSON.stringify(input.allowedCategoryIds),
      input.mcpDefault ? 1 : 0,
      sortOrder,
      now,
      now,
    ],
  );
}

/**
 * All automations. Creates the first one from the legacy settings row (or from
 * safe defaults) the first time it is called on a deployment that has none, so
 * the desk and the MCP tools always have a configuration to work with.
 */
export async function listAutomations(): Promise<AutomationRecord[]> {
  const sql = await getSql();
  const existing = await selectAll(sql);
  if (existing.length > 0) return existing;
  const legacy = await legacySettings(sql);
  const input = legacy ? inputFromLegacy(legacy) : { ...DEFAULT_AUTOMATION_INPUT };
  await insert(sql, "default", input, 0);
  return selectAll(sql);
}

export async function getAutomation(id: string): Promise<AutomationRecord | null> {
  const all = await listAutomations();
  return all.find((item) => item.id === id) ?? null;
}

/** The automation the shared MCP endpoint drives. */
export async function mcpAutomation(preferredId?: string): Promise<AutomationRecord> {
  const all = await listAutomations();
  if (preferredId) {
    const chosen = all.find((item) => item.id === preferredId);
    if (chosen) return chosen;
  }
  return all.find((item) => item.mcpDefault) ?? all[0] as AutomationRecord;
}

export async function createAutomation(raw: unknown): Promise<AutomationRecord> {
  const input = automationInputSchema.parse(raw);
  const sql = await getSql();
  const all = await listAutomations();
  if (all.some((item) => item.name.toLowerCase() === input.name.toLowerCase())) {
    throw new Error("An automation with that name already exists.");
  }
  const id = automationIdFromName(input.name, all.map((item) => item.id));
  await insert(sql, id, { ...input, mcpDefault: all.some((item) => item.mcpDefault) ? input.mcpDefault : true }, all.length);
  if (input.mcpDefault) await clearOtherMcpDefaults(sql, id);
  return (await getAutomation(id)) as AutomationRecord;
}

async function clearOtherMcpDefaults(sql: Sql, keepId: string): Promise<void> {
  await sql.run("update automations set mcp_default = 0 where id <> ?", [keepId]);
}

export async function updateAutomation(id: string, raw: unknown): Promise<AutomationRecord> {
  const input = automationInputSchema.parse(raw);
  const sql = await getSql();
  const all = await listAutomations();
  const current = all.find((item) => item.id === id);
  if (!current) throw new Error("That automation no longer exists.");
  if (all.some((item) => item.id !== id && item.name.toLowerCase() === input.name.toLowerCase())) {
    throw new Error("Another automation already uses that name.");
  }
  const now = new Date().toISOString();
  const scheduleChanged = current.scheduleCron !== input.scheduleCron || current.timezone !== input.timezone;
  await sql.run(
    `update automations set name = ?, enabled = ?, paused = ?, mode = ?, provider = ?, model = ?, base_url = ?,
       credential_ref = ?, topic_source = ?, topic_ideas = ?, topic_sources = ?, category_id = ?, tag_ids = ?,
       language = ?, style = ?, instructions = ?, min_words = ?, image_mode = ?, image_prompt = ?, publish_mode = ?,
       schedule_cron = ?, timezone = ?, max_per_day = ?, retry_max = ?, retry_backoff_seconds = ?,
       require_sources = ?, min_sources = ?, require_cover = ?, allowed_category_ids = ?, mcp_default = ?, updated_at = ?
     where id = ?`,
    [
      input.name,
      input.enabled ? 1 : 0,
      input.paused ? 1 : 0,
      input.mode,
      input.provider,
      input.model,
      input.baseUrl,
      input.credentialRef,
      input.topicSource,
      JSON.stringify(input.topicIdeas),
      JSON.stringify(input.topicSources),
      input.categoryId,
      JSON.stringify(input.tagIds),
      input.language,
      input.style,
      input.instructions,
      input.minWords,
      input.imageMode,
      input.imagePrompt,
      input.publishMode,
      input.scheduleCron,
      input.timezone,
      input.maxPerDay,
      input.retryMax,
      input.retryBackoffSeconds,
      input.requireSources ? 1 : 0,
      input.minSources,
      input.requireCover ? 1 : 0,
      JSON.stringify(input.allowedCategoryIds),
      input.mcpDefault ? 1 : 0,
      now,
      id,
    ],
  );
  if (input.mcpDefault) await clearOtherMcpDefaults(sql, id);
  if (scheduleChanged) {
    // Recompute the next run from now; an edited schedule must never inherit a
    // stale due time (that is how duplicate runs happen).
    const next = input.scheduleCron ? nextRunFor(input.scheduleCron, input.timezone, new Date()) : null;
    await setSchedule(id, { nextRunAt: next, clearLock: true });
  }
  return (await getAutomation(id)) as AutomationRecord;
}

export async function deleteAutomation(id: string): Promise<void> {
  const sql = await getSql();
  const all = await listAutomations();
  if (all.length <= 1) throw new Error("Keep at least one automation: the desk and the MCP connector need one.");
  if (!all.some((item) => item.id === id)) throw new Error("That automation no longer exists.");
  await sql.run("delete from automation_schedule where automation_id = ?", [id]);
  await sql.run("delete from automations where id = ?", [id]);
  // Run history is kept on purpose (article provenance), but detached from the
  // deleted automation is misleading, so its runs are removed too.
  await sql.run("delete from automation_runs where automation_id = ?", [id]);
}

export async function duplicateAutomation(id: string, rawName?: string): Promise<AutomationRecord> {
  const source = await getAutomation(id);
  if (!source) throw new Error("That automation no longer exists.");
  const all = await listAutomations();
  const baseName = (rawName ?? `${source.name} copy`).trim().slice(0, 60);
  let name = baseName;
  let n = 2;
  while (all.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
    name = `${baseName.slice(0, 56)} ${n}`;
    n += 1;
  }
  const { id: _ignored, sortOrder: _order, createdAt: _created, updatedAt: _updated, ...rest } = source;
  return createAutomation({ ...rest, name, enabled: false, paused: false, mcpDefault: false });
}

// ---- schedule state ---------------------------------------------------------

import { nextRunAfter } from "./schedule";

export function nextRunFor(cron: string, timezone: string, from: Date): string | null {
  if (!cron.trim()) return null;
  const next = nextRunAfter(cron, timezone, from);
  return next ? next.toISOString() : null;
}

export type ScheduleState = {
  automationId: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string;
  lastReason: string;
  lockedUntil: string | null;
  failureStreak: number;
};

export async function readSchedules(): Promise<Map<string, ScheduleState>> {
  const sql = await getSql();
  const rows = await sql<
    { automation_id: string; next_run_at: string | null; last_run_at: string | null; last_status: string; last_reason: string; locked_until: string | null; failure_streak: number }
  >`select automation_id, next_run_at, last_run_at, last_status, last_reason, locked_until, failure_streak from automation_schedule`;
  return new Map(
    rows.map((row) => [
      row.automation_id,
      {
        automationId: row.automation_id,
        nextRunAt: row.next_run_at,
        lastRunAt: row.last_run_at,
        lastStatus: row.last_status,
        lastReason: row.last_reason,
        lockedUntil: row.locked_until,
        failureStreak: Number(row.failure_streak ?? 0),
      },
    ]),
  );
}

export async function setSchedule(
  automationId: string,
  patch: { nextRunAt?: string | null; lastRunAt?: string | null; lastStatus?: string; lastReason?: string; failureStreak?: number; clearLock?: boolean; lockToken?: string | null; lockedUntil?: string | null },
): Promise<void> {
  const sql = await getSql();
  const now = new Date().toISOString();
  await sql.run(
    `insert into automation_schedule (automation_id, next_run_at, last_run_at, last_status, last_reason, locked_until, lock_token, failure_streak, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (automation_id) do update set
       next_run_at = coalesce(excluded.next_run_at, automation_schedule.next_run_at),
       last_run_at = coalesce(excluded.last_run_at, automation_schedule.last_run_at),
       last_status = case when excluded.last_status <> '' then excluded.last_status else automation_schedule.last_status end,
       last_reason = case when excluded.last_status <> '' then excluded.last_reason else automation_schedule.last_reason end,
       locked_until = excluded.locked_until,
       lock_token = excluded.lock_token,
       failure_streak = excluded.failure_streak,
       updated_at = excluded.updated_at`,
    [
      automationId,
      patch.nextRunAt ?? null,
      patch.lastRunAt ?? null,
      patch.lastStatus ?? "",
      patch.lastReason ?? "",
      patch.lockedUntil ?? null,
      patch.lockToken ?? null,
      patch.failureStreak ?? 0,
      now,
    ],
  );
}

/**
 * Atomically claims the right to run one automation. Exactly one caller can win
 * because the claim is a single conditional UPDATE; everything else is a no-op.
 */
export async function claimRun(automationId: string, now: Date, lockSeconds: number): Promise<string | null> {
  const sql = await getSql();
  const token = crypto.randomUUID();
  const nowIso = now.toISOString();
  const lockedUntil = new Date(now.getTime() + lockSeconds * 1000).toISOString();
  const existing = await sql<{ automation_id: string }>`select automation_id from automation_schedule where automation_id = ${automationId}`;
  if (existing.length === 0) {
    // Insert with an EMPTY lock: the conditional UPDATE below is what performs
    // the claim. (Setting the lock here would make the first run of a brand-new
    // automation report "already running" and never start.)
    await sql.run(
      `insert or ignore into automation_schedule (automation_id, next_run_at, last_run_at, last_status, last_reason, locked_until, lock_token, failure_streak, updated_at)
       values (?, null, null, '', '', null, null, 0, ?)`,
      [automationId, nowIso],
    );
  }
  const claimed = await sql.run(
    `update automation_schedule set locked_until = ?, lock_token = ?, updated_at = ?
      where automation_id = ? and (locked_until is null or locked_until <= ?)`,
    [lockedUntil, token, nowIso, automationId, nowIso],
  );
  return claimed.changes === 1 ? token : null;
}

export async function releaseRun(automationId: string, token: string): Promise<void> {
  const sql = await getSql();
  await sql.run("update automation_schedule set locked_until = null, lock_token = null where automation_id = ? and lock_token = ?", [automationId, token]);
}

export async function isLocked(automationId: string, token: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ lock_token: string | null }>`select lock_token from automation_schedule where automation_id = ${automationId}`;
  return rows[0]?.lock_token !== token;
}

// ---- run history ------------------------------------------------------------

export type RunRow = {
  id: string;
  automationId: string | null;
  createdAt: string;
  finishedAt: string | null;
  tool: string;
  outcome: string;
  status: string;
  stage: string;
  reason: string;
  articleId: string | null;
  auth: string;
  durationMs: number;
  attempt: number;
  details: Record<string, unknown>;
};

const RUN_COLUMNS = "id, automation_id, created_at, finished_at, tool, outcome, status, stage, reason, article_id, auth, duration_ms, attempt, details";

function toRun(row: Record<string, unknown>): RunRow {
  let details: Record<string, unknown> = {};
  if (typeof row.details === "string" && row.details) {
    try {
      details = JSON.parse(row.details) as Record<string, unknown>;
    } catch {
      details = {};
    }
  }
  return {
    id: String(row.id),
    automationId: (row.automation_id as string | null) ?? null,
    createdAt: String(row.created_at),
    finishedAt: (row.finished_at as string | null) ?? null,
    tool: String(row.tool),
    outcome: String(row.outcome),
    status: String(row.status ?? ""),
    stage: String(row.stage ?? ""),
    reason: String(row.reason ?? ""),
    articleId: (row.article_id as string | null) ?? null,
    auth: String(row.auth ?? ""),
    durationMs: Number(row.duration_ms ?? 0),
    attempt: Number(row.attempt ?? 1),
    details,
  };
}

export type RunRecordInput = {
  automationId?: string | null;
  tool: string;
  outcome: string;
  status?: string;
  stage?: string;
  reason?: string;
  articleId?: string | null;
  auth?: string;
  durationMs?: number;
  attempt?: number;
  details?: Record<string, unknown>;
};

/** Writes one run row. Returns the id, or null when logging itself failed. */
export async function recordRun(run: RunRecordInput): Promise<string | null> {
  try {
    const sql = await getSql();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await sql.run(
      `insert into automation_runs (id, created_at, finished_at, tool, outcome, status, stage, reason, article_id, automation_id, auth, duration_ms, attempt, details)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        now,
        now,
        run.tool,
        run.outcome,
        run.status ?? "",
        run.stage ?? "",
        (run.reason ?? "").slice(0, 1000),
        run.articleId ?? null,
        run.automationId ?? null,
        run.auth ?? "",
        Math.max(0, Math.round(run.durationMs ?? 0)),
        Math.max(1, Math.round(run.attempt ?? 1)),
        JSON.stringify(run.details ?? {}).slice(0, 4000),
      ],
    );
    return id;
  } catch (error) {
    console.error("[automation] could not record run", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

export async function recentRuns(limit = 25, automationId?: string): Promise<RunRow[]> {
  try {
    const sql = await getSql();
    const rows = automationId
      ? await sql.query<Record<string, unknown>>(`select ${RUN_COLUMNS} from automation_runs where automation_id = ? order by created_at desc limit ?`, [automationId, limit])
      : await sql.query<Record<string, unknown>>(`select ${RUN_COLUMNS} from automation_runs order by created_at desc limit ?`, [limit]);
    return rows.map(toRun);
  } catch {
    return [];
  }
}

export async function runCounts(automationId: string): Promise<{ total: number; failed: number }> {
  try {
    const sql = await getSql();
    const rows = await sql<{ total: number; failed: number }>`select count(*) as total,
      sum(case when status = 'failed' then 1 else 0 end) as failed from automation_runs where automation_id = ${automationId}`;
    return { total: Number(rows[0]?.total ?? 0), failed: Number(rows[0]?.failed ?? 0) };
  } catch {
    return { total: 0, failed: 0 };
  }
}

export async function automatedPublishesToday(automationId?: string): Promise<number> {
  const sql = await getSql();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const rows = automationId
    ? await sql<{ n: number }>`select count(*) as n from automation_runs
        where tool = 'publish_article_if_allowed' and outcome = 'published' and automation_id = ${automationId} and created_at >= ${since.toISOString()}`
    : await sql<{ n: number }>`select count(*) as n from automation_runs
        where tool = 'publish_article_if_allowed' and outcome = 'published' and created_at >= ${since.toISOString()}`;
  return Number(rows[0]?.n ?? 0);
}

/** Titles of the most recent articles, newest first (dedupe source for topics). */
export async function recentTitles(limit = 40): Promise<string[]> {
  const sql = await getSql();
  const rows = await sql<{ title: string }>`select title from articles order by updated_at desc limit ${limit}`;
  return rows.map((row) => row.title);
}

// ---- popularity (genuine metric) -------------------------------------------

/** Counts one article view for today (UTC). Best effort: never breaks a page. */
export async function recordArticleView(articleId: string): Promise<void> {
  try {
    const sql = await getSql();
    const day = new Date().toISOString().slice(0, 10);
    await sql.run(
      `insert into article_views (article_id, day, count) values (?, ?, 1)
       on conflict (article_id, day) do update set count = count + 1`,
      [articleId, day],
    );
  } catch (error) {
    console.error("[views] could not record a view", error instanceof Error ? error.message : "unknown");
  }
}

export type RankedArticle = { articleId: string; views: number };

export async function mostViewed(days: number, limit: number): Promise<RankedArticle[]> {
  const sql = await getSql();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await sql<{ article_id: string; views: number }>`
    select article_id, sum(count) as views from article_views where day >= ${since}
    group by article_id order by views desc limit ${limit}`;
  return rows.map((row) => ({ articleId: row.article_id, views: Number(row.views) }));
}

export async function viewTotals(): Promise<Map<string, number>> {
  const sql = await getSql();
  const rows = await sql<{ article_id: string; views: number }>`select article_id, sum(count) as views from article_views group by article_id`;
  return new Map(rows.map((row) => [row.article_id, Number(row.views)]));
}

// ---- environment helpers used by the desk ----------------------------------

export async function automationEnv() {
  return workerEnv();
}
