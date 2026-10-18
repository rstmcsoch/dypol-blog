import { getSql } from "@/lib/db";
import {
  automationSettingsSchema,
  normalizeAutomationSettings,
  type AutomationSettings,
} from "@/lib/automation/settings";
import { ensureContent } from "./repository.server";
import { constantTimeEqual, type ProfileBinding, type ProfileResolver } from "@/lib/mcp/auth";
import { hashToken, newProfileId, newProfileToken, parseProfileToken, PROFILE_ID_RE, tokenVersion } from "@/lib/automation/profile-token";

/** Storage for AI-connector automation: settings row, submissions (idempotency) and the run log. */

export async function readAutomationSettings(): Promise<AutomationSettings> {
  await ensureContent();
  const sql = await getSql();
  const rows = await sql<{ data: string }>`select data from site_settings where id = 'automation'`;
  const raw = rows[0]?.data;
  return normalizeAutomationSettings(typeof raw === "string" ? JSON.parse(raw) : raw);
}

export async function saveAutomationSettings(raw: unknown): Promise<AutomationSettings> {
  const settings = automationSettingsSchema.parse(raw);
  const sql = await getSql();
  await sql`insert into site_settings (id, data) values ('automation', ${JSON.stringify(settings)})
    on conflict (id) do update set data = excluded.data`;
  return settings;
}

export type RunRecord = {
  profileId?: string;
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
    const values = [id, new Date().toISOString(), run.tool, run.outcome, (run.reason ?? "").slice(0, 1000), run.articleId ?? null, run.auth ?? "", JSON.stringify(run.details ?? {}).slice(0, 4000)];
    try {
      await sql.query(
        "insert into automation_runs (id, created_at, tool, outcome, reason, article_id, auth, details, profile_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [...values, run.profileId ?? "default"],
      );
    } catch {
      // Database without migration 0004: keep logging without the profile column.
      await sql.query("insert into automation_runs (id, created_at, tool, outcome, reason, article_id, auth, details) values ($1,$2,$3,$4,$5,$6,$7,$8)", values);
    }
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
  profileId: string;
  /** "explicit" for a deliberate MCP publish/edit instruction, "automatic" for policy-driven flows. */
  mode: string | null;
};

export async function recentRuns(limit = 20, profileId?: string): Promise<RunRow[]> {
  try {
    const sql = await getSql();
    type Row = { id: string; created_at: string; tool: string; outcome: string; reason: string; article_id: string | null; auth: string; profile_id?: string | null; details?: string | null };
    let rows: Row[];
    try {
      rows = profileId
        ? await sql<Row>`select id, created_at, tool, outcome, reason, article_id, auth, profile_id, details from automation_runs
            where coalesce(profile_id, 'default') = ${profileId} order by created_at desc limit ${limit}`
        : await sql<Row>`select id, created_at, tool, outcome, reason, article_id, auth, profile_id, details from automation_runs order by created_at desc limit ${limit}`;
    } catch {
      rows = await sql<Row>`select id, created_at, tool, outcome, reason, article_id, auth from automation_runs order by created_at desc limit ${limit}`;
    }
    return rows.map((r) => {
      let mode: string | null = r.outcome === "published_explicit" ? "explicit" : null;
      try {
        const d = JSON.parse(r.details ?? "{}") as { mode?: unknown };
        if (typeof d.mode === "string") mode = d.mode;
      } catch { /* details are best-effort */ }
      return {
        profileId: r.profile_id ?? "default",
        id: r.id,
        createdAt: r.created_at,
        tool: r.tool,
        outcome: r.outcome,
        reason: r.reason,
        articleId: r.article_id,
        auth: r.auth,
        mode,
      };
    });
  } catch {
    return [];
  }
}

export type Submission = {
  idempotencyKey: string;
  contentHash: string;
  articleId: string;
  sourceUrls: string[];
  flags: string[];
  provider: string;
  createdAt: string;
  profileId?: string;
};

type SubmissionRow = {
  idempotency_key: string;
  content_hash: string;
  article_id: string;
  source_urls: string;
  flags: string;
  provider: string;
  created_at: string;
  profile_id?: string | null;
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
    profileId: r.profile_id ?? "default",
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
  const values = [s.idempotencyKey, s.contentHash, s.articleId, JSON.stringify(s.sourceUrls), JSON.stringify(s.flags), s.provider, s.createdAt];
  try {
    await sql.query(
      "insert or ignore into automation_submissions (idempotency_key, content_hash, article_id, source_urls, flags, provider, created_at, profile_id) values ($1,$2,$3,$4,$5,$6,$7,$8)",
      [...values, s.profileId ?? "default"],
    );
  } catch {
    await sql.query(
      "insert or ignore into automation_submissions (idempotency_key, content_hash, article_id, source_urls, flags, provider, created_at) values ($1,$2,$3,$4,$5,$6,$7)",
      values,
    );
  }
  return (await findSubmission({ key: s.idempotencyKey })) ?? s;
}

export async function updateSubmissionSources(articleId: string, sourceUrls: string[]): Promise<void> {
  const sql = await getSql();
  await sql`update automation_submissions set source_urls = ${JSON.stringify(sourceUrls)} where article_id = ${articleId}`;
}

export async function setSubmissionFlags(articleId: string, flags: string[]): Promise<void> {
  const sql = await getSql();
  await sql`update automation_submissions set flags = ${JSON.stringify(flags)} where article_id = ${articleId}`;
}

/** Automatic publishes since 00:00 UTC, for one profile (each profile has its own daily limit). */
export async function automatedPublishesToday(profileId = "default"): Promise<number> {
  const sql = await getSql();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  try {
    const rows = await sql<{ n: number }>`select count(*) as n from automation_runs
      where tool = 'publish_article_if_allowed' and outcome = 'published' and created_at >= ${since.toISOString()}
        and coalesce(profile_id, 'default') = ${profileId}`;
    return Number(rows[0]?.n ?? 0);
  } catch {
    const rows = await sql<{ n: number }>`select count(*) as n from automation_runs
      where tool = 'publish_article_if_allowed' and outcome = 'published' and created_at >= ${since.toISOString()}`;
    return Number(rows[0]?.n ?? 0);
  }
}

// ---- Profiles ------------------------------------------------------------------

export type ProfileSummary = {
  id: string;
  name: string;
  isDefault: boolean;
  enabled: boolean;
  paused: boolean;
  hasToken: boolean;
  tokenHint: string | null;
  tokenCreatedAt: string | null;
};

type ProfileRow = { id: string; name: string; settings: string; token_hash: string | null; token_hint: string | null; token_created_at: string | null };

export const DEFAULT_PROFILE_NAME = "Default (master MCP token)";

async function profileRows(): Promise<ProfileRow[]> {
  try {
    const sql = await getSql();
    return await sql<ProfileRow>`select id, name, settings, token_hash, token_hint, token_created_at from automation_profiles order by created_at`;
  } catch {
    return []; // migration 0004 not applied yet: only the default profile exists
  }
}

export async function listProfiles(): Promise<ProfileSummary[]> {
  const def = await readAutomationSettings();
  const rows = await profileRows();
  return [
    { id: "default", name: DEFAULT_PROFILE_NAME, isDefault: true, enabled: def.enabled, paused: def.paused, hasToken: true, tokenHint: null, tokenCreatedAt: null },
    ...rows.map((r) => {
      const s = normalizeAutomationSettings(JSON.parse(r.settings || "{}"));
      return { id: r.id, name: r.name, isDefault: false, enabled: s.enabled, paused: s.paused, hasToken: Boolean(r.token_hash), tokenHint: r.token_hint, tokenCreatedAt: r.token_created_at };
    }),
  ];
}

export class ProfileError extends Error {}

function checkId(id: string): void {
  if (id !== "default" && !PROFILE_ID_RE.test(id)) throw new ProfileError("Unknown automation profile.");
}

/**
 * Settings for a profile. Site-wide connector options (mode, server API,
 * extra client hosts) always come from the default profile.
 */
export async function readProfileSettings(id: string): Promise<AutomationSettings> {
  checkId(id);
  const def = await readAutomationSettings();
  if (id === "default") return def;
  const sql = await getSql();
  const rows = await sql<{ settings: string }>`select settings from automation_profiles where id = ${id}`;
  if (!rows[0]) throw new ProfileError("That automation profile no longer exists.");
  const own = normalizeAutomationSettings(JSON.parse(rows[0].settings || "{}"));
  return { ...own, mode: def.mode, serverApi: def.serverApi, extraClientHosts: def.extraClientHosts };
}

export async function saveProfileSettings(id: string, raw: unknown): Promise<AutomationSettings> {
  checkId(id);
  if (id === "default") return saveAutomationSettings(raw);
  const settings = automationSettingsSchema.parse(raw);
  const sql = await getSql();
  const done = await sql<{ id: string }>`update automation_profiles set settings = ${JSON.stringify(settings)}, updated_at = ${new Date().toISOString()}
    where id = ${id} returning id`;
  if (!done[0]) throw new ProfileError("That automation profile no longer exists.");
  return settings;
}

function cleanName(name: unknown): string {
  const n = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  if (n.length < 2) throw new ProfileError("Give the profile a name (2-60 characters).");
  return n;
}

/** New profiles start disabled with the default's topics/policy copied, auto-publish off. */
export async function createProfile(name: unknown): Promise<ProfileSummary> {
  const clean = cleanName(name);
  const base = await readAutomationSettings();
  const settings: AutomationSettings = { ...base, enabled: false, paused: false, policy: { ...base.policy, autoPublish: false }, imageTransfer: "untested" };
  const id = newProfileId();
  const now = new Date().toISOString();
  const sql = await getSql();
  await sql`insert into automation_profiles (id, name, settings, created_at, updated_at) values (${id}, ${clean}, ${JSON.stringify(settings)}, ${now}, ${now})`;
  return { id, name: clean, isDefault: false, enabled: false, paused: false, hasToken: false, tokenHint: null, tokenCreatedAt: null };
}

export async function renameProfile(id: string, name: unknown): Promise<void> {
  checkId(id);
  if (id === "default") throw new ProfileError("The default profile can't be renamed.");
  const sql = await getSql();
  await sql`update automation_profiles set name = ${cleanName(name)}, updated_at = ${new Date().toISOString()} where id = ${id}`;
}

/** Removes the profile (its token stops working). Its past runs and drafts are kept. */
export async function deleteProfile(id: string): Promise<void> {
  checkId(id);
  if (id === "default") throw new ProfileError("The default profile can't be deleted.");
  const sql = await getSql();
  await sql`delete from automation_profiles where id = ${id}`;
}

/** Creates (or replaces) the profile's token. Returned once; only its hash is stored. */
export async function issueProfileToken(id: string): Promise<{ token: string; hint: string }> {
  checkId(id);
  if (id === "default") throw new ProfileError("The default profile uses the MCP_TOKEN secret.");
  const token = newProfileToken(id);
  const hint = token.slice(-4);
  const sql = await getSql();
  const done = await sql<{ id: string }>`update automation_profiles set token_hash = ${await hashToken(token)}, token_hint = ${hint},
    token_created_at = ${new Date().toISOString()}, updated_at = ${new Date().toISOString()} where id = ${id} returning id`;
  if (!done[0]) throw new ProfileError("That automation profile no longer exists.");
  return { token, hint };
}

export async function revokeProfileToken(id: string): Promise<void> {
  checkId(id);
  const sql = await getSql();
  await sql`update automation_profiles set token_hash = null, token_hint = null, token_created_at = null, updated_at = ${new Date().toISOString()} where id = ${id}`;
}

// ---- Topic-selection cursor (sequence mode) --------------------------------
/** Next sequence index for a profile. 0 until migration 0005 is applied. */
export async function readTopicCursor(profileId: string): Promise<number> {
  try {
    const sql = await getSql();
    const rows = await sql<{ cursor: number }>`select cursor from automation_topic_state where profile_id = ${profileId}`;
    return Number(rows[0]?.cursor ?? 0);
  } catch {
    return 0;
  }
}

/** Store the next sequence index after a topic was actually used. Best-effort. */
export async function writeTopicCursor(profileId: string, cursor: number): Promise<void> {
  try {
    const sql = await getSql();
    const now = new Date().toISOString();
    await sql`insert into automation_topic_state (profile_id, cursor, updated_at) values (${profileId}, ${cursor}, ${now})
      on conflict (profile_id) do update set cursor = excluded.cursor, updated_at = excluded.updated_at`;
  } catch {
    // Migration 0005 not applied yet: sequence suggestions still work from 0.
  }
}

/** Resolver used by MCP auth: token -> profile, and "is this binding still current?". */
export const profileResolver: ProfileResolver = {
  async byToken(token: string): Promise<ProfileBinding | null> {
    const parsed = parseProfileToken(token);
    if (!parsed) return null;
    const rows = await profileRows();
    const row = rows.find((r) => r.id === parsed.profileId);
    if (!row?.token_hash) return null;
    const hash = await hashToken(token);
    return constantTimeEqual(hash, row.token_hash) ? { id: row.id, version: tokenVersion(row.token_hash) } : null;
  },
  async stillValid(binding: ProfileBinding): Promise<boolean> {
    if (binding.id === "default") return true;
    const rows = await profileRows();
    const row = rows.find((r) => r.id === binding.id);
    return Boolean(row?.token_hash) && constantTimeEqual(tokenVersion(row!.token_hash!), binding.version);
  },
};
