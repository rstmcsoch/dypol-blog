import { getSql } from "@/lib/db";
import * as rotationHelpers from "@/lib/author-rotation";
import {
  automationSettingsSchema,
  normalizeAutomationSettings,
  type AutomationSettings,
} from "@/lib/automation/settings";
import { ensureContent } from "./repository.server";
import { constantTimeEqual, cleanClientName, type ProfileBinding, type ProfileResolver } from "@/lib/mcp/auth";
import { hashToken, newProfileId, newProfileToken, parseProfileToken, PROFILE_ID_RE, tokenVersion } from "@/lib/automation/profile-token";
import { newOauthClientId, newOauthClientSecret, parseAdminRedirects, OAUTH_CLIENT_ID_RE } from "@/lib/automation/oauth-client";

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

/** One AI publish (or in-flight claim) from the run log. */
export type AiPublishUsageRow = { createdAt: string; runKey: string | null; profileId: string };

function usageFromRows(rows: { created_at: string; details?: string | null; profile_id?: string | null }[]): AiPublishUsageRow[] {
  return rows.map((r) => {
    let runKey: string | null = null;
    try {
      const d = JSON.parse(r.details ?? "{}") as { runKey?: unknown };
      if (typeof d.runKey === "string") runKey = d.runKey;
    } catch { /* details are best-effort */ }
    return { createdAt: r.created_at, runKey, profileId: r.profile_id ?? "default" };
  });
}

/**
 * Today's (UTC) AI publishes across ALL profiles or one profile,
 * counting automatic + explicit + in-flight claims (t64). Admin
 * manual publishing never appears here, so it is never capped.
 */
export async function aiPublishUsageToday(profileId?: string): Promise<AiPublishUsageRow[]> {
  const sql = await getSql();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  try {
    const rows = profileId
      ? await sql<{ created_at: string; details?: string | null; profile_id?: string | null }>`
          select created_at, details, profile_id from automation_runs
          where tool = 'publish_article_if_allowed' and outcome in ('published', 'published_explicit', 'publish_claim') and created_at >= ${since.toISOString()}
            and coalesce(profile_id, 'default') = ${profileId} order by created_at asc`
      : await sql<{ created_at: string; details?: string | null; profile_id?: string | null }>`
          select created_at, details, profile_id from automation_runs
          where tool = 'publish_article_if_allowed' and outcome in ('published', 'published_explicit', 'publish_claim') and created_at >= ${since.toISOString()}
          order by created_at asc`;
    return usageFromRows(rows as never);
  } catch {
    return [];
  }
}

/** Website-wide daily AI publish cap from site settings (0 = no limit). */
export async function readWebsiteAiDailyLimit(): Promise<number> {
  try {
    const sql = await getSql();
    const rows = await sql<{ data: string }>`select data from site_settings where id = 'site'`;
    const raw = typeof rows[0]?.data === "string" ? JSON.parse(rows[0].data) : rows[0]?.data;
    const value = (raw as { aiDailyPublishLimit?: unknown } | undefined)?.aiDailyPublishLimit;
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.floor(value))) : 0;
  } catch {
    return 0;
  }
}

/**
 * Claim-first publish guard (t64): the claim row is written BEFORE the
 * article status flips and counts toward both caps, so concurrent
 * automations see each other's in-flight publishes. Settle it to the
 * final outcome after the flip; delete it when the publish is aborted.
 */
export async function claimAiPublish(input: { profileId: string; runKey: string; mode: "automatic" | "explicit"; articleId: string; auth: string }): Promise<string | null> {
  return recordRun({
    profileId: input.profileId,
    tool: "publish_article_if_allowed",
    outcome: "publish_claim",
    articleId: input.articleId,
    auth: input.auth,
    details: { runKey: input.runKey, mode: input.mode, claimed: true },
  });
}

export async function settleAiPublishClaim(claimId: string | null, outcome: "published" | "published_explicit", details: Record<string, unknown>): Promise<void> {
  if (!claimId) return;
  try {
    const sql = await getSql();
    await sql`update automation_runs set outcome = ${outcome}, details = ${JSON.stringify(details).slice(0, 4000)} where id = ${claimId}`;
  } catch {
    // Best-effort audit; the article state is already correct.
  }
}

export async function releaseAiPublishClaim(claimId: string | null): Promise<void> {
  if (!claimId) return;
  try {
    const sql = await getSql();
    await sql`delete from automation_runs where id = ${claimId} and outcome = 'publish_claim'`;
  } catch {
    // Best-effort audit cleanup.
  }
}

// ---- Profiles ------------------------------------------------------------------

export type OauthClientPublic = {
  clientId: string;
  secretHint: string | null;
  redirectUris: string[];
  createdAt: string;
};

export type ProfileSummary = {
  id: string;
  name: string;
  isDefault: boolean;
  enabled: boolean;
  paused: boolean;
  hasToken: boolean;
  tokenHint: string | null;
  tokenCreatedAt: string | null;
  oauth: OauthClientPublic | null;
  /** t141: byline for articles this profile creates (null = DYPOL LABS). t169: = authors[0]. */
  authorName: string | null;
  /** t169: rotating author list (admin order) and who the next published article gets. */
  authors: string[];
  nextAuthor: string | null;
};

type ProfileRow = { id: string; name: string; settings: string; token_hash: string | null; token_hint: string | null; token_created_at: string | null; author_name?: string | null };

const DEFAULT_AUTHOR_KEY = "automation_default_author";

async function readDefaultAuthor(): Promise<string | null> {
  try {
    const sql = await getSql();
    const rows = await sql<{ data: string }>`select data from site_settings where id = ${DEFAULT_AUTHOR_KEY}`;
    const v = rows[0] ? (JSON.parse(rows[0].data) as unknown) : null;
    return typeof v === "string" && v.trim() ? v : null;
  } catch {
    return null;
  }
}

/** t141: the author name a profile stamps on the articles it creates. */
export async function profileAuthorName(id: string): Promise<string | null> {
  if (id === "default") return readDefaultAuthor();
  try {
    const sql = await getSql();
    const rows = await sql<{ author_name: string | null }>`select author_name from automation_profiles where id = ${id}`;
    return rows[0]?.author_name?.trim() || null;
  } catch {
    return null; // pre-0022 database
  }
}

/** t141: set (or clear with "") a profile's single author name. t169: = a one-name rotation list. */
export async function setProfileAuthor(id: string, raw: unknown): Promise<string | null> {
  checkId(id);
  const { checkAuthorName } = await import("@/lib/author-name");
  const checked = checkAuthorName(raw);
  if (!checked.ok) throw new ProfileError(checked.error);
  const saved = await saveAuthorList(id, checked.value ? [checked.value] : []);
  return saved.names[0] ?? null;
}

// ---- t169: rotating author names --------------------------------------------

export type AuthorRotation = { names: string[]; nextIndex: number; nextUp: string | null };

type RotationRow = { profile_id: string; names: string; next_index: number };

function parseNames(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
  } catch {
    return [];
  }
}

async function rotationRows(): Promise<Map<string, RotationRow>> {
  try {
    const sql = await getSql();
    const rows = await sql<RotationRow>`select profile_id, names, next_index from automation_authors`;
    return new Map(rows.map((r) => [r.profile_id, r]));
  } catch {
    return new Map(); // pre-0026 database
  }
}

function toRotation(row: RotationRow | undefined, single: string | null): AuthorRotation {
  const { nextUpName } = rotationHelpers;
  // No rotation row yet (pre-0026 or never saved): the single author name is a one-name list.
  const names = row ? parseNames(row.names) : single ? [single] : [];
  const nextIndex = row && names.length ? ((Number(row.next_index) % names.length) + names.length) % names.length : 0;
  return { names, nextIndex, nextUp: nextUpName(names, nextIndex) };
}


export async function readAuthorRotation(id: string): Promise<AuthorRotation> {
  checkId(id);
  const rows = await rotationRows();
  return toRotation(rows.get(id), await profileAuthorName(id));
}

/**
 * Save a profile's ordered author list. Validated (trimmed, unique, 2-60
 * chars, max 25) and unique across profiles. The person who was next up
 * stays next up when the list is reordered; `reset` starts again at #1.
 * The first name is mirrored into the single author column, which bylines
 * of older articles with no stored author already fall back to.
 */
export async function saveAuthorList(id: string, raw: unknown, opts: { reset?: boolean } = {}): Promise<AuthorRotation> {
  checkId(id);
  const { checkAuthorList, cursorAfterEdit } = rotationHelpers;
  const checked = checkAuthorList(raw);
  if (!checked.ok) throw new ProfileError(checked.error);
  const names = checked.names;
  const profiles = await listProfiles();
  const self = profiles.find((p) => p.id === id);
  if (!self) throw new ProfileError("That automation profile no longer exists.");
  for (const name of names) {
    const taken = profiles.find((p) => p.id !== id && p.authors.some((n) => n.toLowerCase() === name.toLowerCase()));
    if (taken) throw new ProfileError(`“${taken.name}” already uses the author name “${name}”. Pick a different name.`);
  }
  const current = await readAuthorRotation(id);
  const nextIndex = opts.reset ? 0 : cursorAfterEdit(current.names, current.nextIndex, names);
  const sql = await getSql();
  const now = new Date().toISOString();
  await sql`insert into automation_authors (profile_id, names, next_index, updated_at) values (${id}, ${JSON.stringify(names)}, ${nextIndex}, ${now})
    on conflict (profile_id) do update set names = excluded.names, next_index = excluded.next_index, updated_at = excluded.updated_at`;
  const first = names[0] ?? null;
  if (id === "default") {
    if (first) await sql`insert into site_settings (id, data) values (${DEFAULT_AUTHOR_KEY}, ${JSON.stringify(first)}) on conflict (id) do update set data = excluded.data`;
    else await sql`delete from site_settings where id = ${DEFAULT_AUTHOR_KEY}`;
  } else {
    await sql`update automation_profiles set author_name = ${first}, updated_at = ${now} where id = ${id}`;
  }
  return { names, nextIndex, nextUp: rotationHelpers.nextUpName(names, nextIndex) };
}

/**
 * Take the profile's next author for a newly published article. One atomic
 * UPDATE ... RETURNING: concurrent publishes each get their own slot.
 * Returns null when the profile has no author names (byline = fallback).
 */
export async function takeAuthorTurn(id: string): Promise<string | null> {
  const sql = await getSql();
  let rows: Array<{ names: string; next_index: number }>;
  try {
    rows = await sql.query<{ names: string; next_index: number }>(rotationHelpers.TAKE_TURN_SQL, [new Date().toISOString(), id]);
  } catch {
    return profileAuthorName(id); // pre-0026 database: the single author name
  }
  return rotationHelpers.nameFromTurnRow(rows[0]);
}

export const DEFAULT_PROFILE_NAME = "Default (master MCP token)";

async function profileRows(): Promise<ProfileRow[]> {
  try {
    const sql = await getSql();
    try {
      return await sql<ProfileRow>`select id, name, settings, token_hash, token_hint, token_created_at, author_name from automation_profiles order by created_at`;
    } catch {
      return await sql<ProfileRow>`select id, name, settings, token_hash, token_hint, token_created_at from automation_profiles order by created_at`;
    }
  } catch {
    return []; // migration 0004 not applied yet: only the default profile exists
  }
}

export async function listProfiles(): Promise<ProfileSummary[]> {
  const def = await readAutomationSettings();
  const rows = await profileRows();
  const oauth = await oauthByProfile();
  const defaultAuthor = await readDefaultAuthor();
  const rotations = await rotationRows();
  const pub = (id: string): OauthClientPublic | null => oauth.get(id)?.public ?? null;
  const rot = (id: string, single: string | null) => {
    const r = toRotation(rotations.get(id), single);
    return { authors: r.names, nextAuthor: r.nextUp };
  };
  return [
    { id: "default", name: DEFAULT_PROFILE_NAME, isDefault: true, enabled: def.enabled, paused: def.paused, hasToken: true, tokenHint: null, tokenCreatedAt: null, oauth: pub("default"), authorName: defaultAuthor, ...rot("default", defaultAuthor) },
    ...rows.map((r) => {
      const s = normalizeAutomationSettings(JSON.parse(r.settings || "{}"));
      return { id: r.id, name: r.name, isDefault: false, enabled: s.enabled, paused: s.paused, hasToken: Boolean(r.token_hash), tokenHint: r.token_hint, tokenCreatedAt: r.token_created_at, oauth: pub(r.id), authorName: r.author_name?.trim() || null, ...rot(r.id, r.author_name?.trim() || null) };
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
  return { id, name: clean, isDefault: false, enabled: false, paused: false, hasToken: false, tokenHint: null, tokenCreatedAt: null, oauth: null, authorName: null, authors: [], nextAuthor: null };
}

export async function renameProfile(id: string, name: unknown): Promise<void> {
  checkId(id);
  if (id === "default") throw new ProfileError("The default profile can't be renamed.");
  const clean = cleanName(name);
  const sql = await getSql();
  await sql`update automation_profiles set name = ${clean}, updated_at = ${new Date().toISOString()} where id = ${id}`;
  await sql`update automation_oauth_clients set name = ${cleanClientName(clean)}, updated_at = ${new Date().toISOString()} where profile_id = ${id}`.catch(() => undefined);
}

/** Removes the profile (its token stops working). Its past runs and drafts are kept. */
export async function deleteProfile(id: string): Promise<void> {
  checkId(id);
  if (id === "default") throw new ProfileError("The default profile can't be deleted.");
  const sql = await getSql();
  await sql`delete from automation_oauth_clients where profile_id = ${id}`.catch(() => undefined);
  await sql`delete from automation_authors where profile_id = ${id}`.catch(() => undefined);
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

// ---- Confidential OAuth clients (client id + secret) -----------------------

type OauthRow = {
  profile_id: string;
  client_id: string;
  secret_hash: string;
  secret_hint: string | null;
  name: string;
  redirect_uris: string;
  created_at: string;
};

export type OauthClientRecord = OauthClientPublic & { profileId: string; name: string; secretVersion: string };

let oauthTableReady = false;

async function ensureOauthClients(): Promise<void> {
  if (oauthTableReady) return;
  const sql = await getSql();
  await sql`create table if not exists automation_oauth_clients (
    profile_id text primary key,
    client_id text not null unique,
    secret_hash text not null,
    secret_hint text,
    name text not null,
    redirect_uris text not null,
    created_at text not null,
    updated_at text not null
  )`;
  oauthTableReady = true;
}

function parseStoredUris(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((u): u is string => typeof u === "string") : [];
  } catch {
    return [];
  }
}

function toOauthRecord(row: OauthRow): OauthClientRecord {
  return {
    profileId: row.profile_id,
    clientId: row.client_id,
    name: row.name,
    secretHint: row.secret_hint,
    redirectUris: parseStoredUris(row.redirect_uris),
    createdAt: row.created_at,
    secretVersion: tokenVersion(row.secret_hash),
  };
}

async function oauthRows(): Promise<OauthRow[]> {
  try {
    await ensureOauthClients();
    const sql = await getSql();
    return await sql<OauthRow>`select profile_id, client_id, secret_hash, secret_hint, name, redirect_uris, created_at from automation_oauth_clients`;
  } catch {
    return [];
  }
}

async function oauthByProfile(): Promise<Map<string, { public: OauthClientPublic }>> {
  const map = new Map<string, { public: OauthClientPublic }>();
  for (const row of await oauthRows()) {
    const record = toOauthRecord(row);
    map.set(row.profile_id, { public: { clientId: record.clientId, secretHint: record.secretHint, redirectUris: record.redirectUris, createdAt: record.createdAt } });
  }
  return map;
}

export async function oauthClientById(clientId: string): Promise<OauthClientRecord | null> {
  if (!OAUTH_CLIENT_ID_RE.test(clientId)) return null;
  const row = (await oauthRows()).find((r) => r.client_id === clientId);
  return row ? toOauthRecord(row) : null;
}

/** Constant-time secret check. Unknown id and wrong secret both return null. */
export async function authenticateOauthClient(clientId: string, secret: string): Promise<OauthClientRecord | null> {
  const presented = await hashToken(secret.slice(0, 512));
  const row = OAUTH_CLIENT_ID_RE.test(clientId) ? (await oauthRows()).find((r) => r.client_id === clientId) : undefined;
  const stored = row?.secret_hash && /^[0-9a-f]{64}$/.test(row.secret_hash) ? row.secret_hash : "0".repeat(64);
  if (!constantTimeEqual(presented, stored) || !row) return null;
  return toOauthRecord(row);
}

async function assertProfileExists(profileId: string): Promise<void> {
  checkId(profileId);
  if (profileId === "default") return;
  const sql = await getSql();
  const rows = await sql<{ id: string }>`select id from automation_profiles where id = ${profileId}`;
  if (!rows[0]) throw new ProfileError("That automation profile no longer exists.");
}

/** Creates or replaces the profile's OAuth client. The secret is returned once. */
export async function issueOauthClient(profileId: string, redirectInput: unknown, name: string): Promise<{ clientId: string; clientSecret: string; secretHint: string; redirectUris: string[] }> {
  await assertProfileExists(profileId);
  const redirectUris = parseAdminRedirects(redirectInput);
  await ensureOauthClients();
  const clientSecret = newOauthClientSecret();
  const secretHint = clientSecret.slice(-4);
  const clientId = newOauthClientId();
  const now = new Date().toISOString();
  const sql = await getSql();
  await sql`insert into automation_oauth_clients (profile_id, client_id, secret_hash, secret_hint, name, redirect_uris, created_at, updated_at)
    values (${profileId}, ${clientId}, ${await hashToken(clientSecret)}, ${secretHint}, ${cleanClientName(name)}, ${JSON.stringify(redirectUris)}, ${now}, ${now})
    on conflict (profile_id) do update set
      client_id = excluded.client_id,
      secret_hash = excluded.secret_hash,
      secret_hint = excluded.secret_hint,
      name = excluded.name,
      redirect_uris = excluded.redirect_uris,
      updated_at = excluded.updated_at`;
  return { clientId, clientSecret, secretHint, redirectUris };
}

export async function updateOauthRedirects(profileId: string, redirectInput: unknown): Promise<string[]> {
  await assertProfileExists(profileId);
  const redirectUris = parseAdminRedirects(redirectInput);
  await ensureOauthClients();
  const sql = await getSql();
  const done = await sql<{ profile_id: string }>`update automation_oauth_clients set redirect_uris = ${JSON.stringify(redirectUris)}, updated_at = ${new Date().toISOString()}
    where profile_id = ${profileId} returning profile_id`;
  if (!done[0]) throw new ProfileError("Create an OAuth client for this profile first.");
  return redirectUris;
}

export async function revokeOauthClient(profileId: string): Promise<void> {
  checkId(profileId);
  await ensureOauthClients();
  const sql = await getSql();
  await sql`delete from automation_oauth_clients where profile_id = ${profileId}`;
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
  async oauthClientStillValid(profileId: string, version: string): Promise<boolean> {
    if (profileId !== "default" && !PROFILE_ID_RE.test(profileId)) return false;
    if (!/^[0-9a-f]{12}$/.test(version)) return false;
    const row = (await oauthRows()).find((r) => r.profile_id === profileId);
    if (!row || !constantTimeEqual(tokenVersion(row.secret_hash), version)) return false;
    if (profileId === "default") return true;
    return (await profileRows()).some((p) => p.id === profileId);
  },
};
