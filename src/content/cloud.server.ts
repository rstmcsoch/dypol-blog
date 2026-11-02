/**
 * t173: cloud connector state (D1 cloud_connections) + OAuth flow. Tokens are
 * sealed with CLOUD_TOKEN_KEY and never returned to the browser or AI tools.
 * A provider is only ever "connected" after a real token exchange succeeded.
 */
import { getSql } from "@/lib/db";
import { workerEnv } from "@/lib/cf-env.server";
import {
  CLOUD_IDS, PROTON, PROVIDERS, authorizeUrl, cloudApi, exchangeCode, grantedCaps, isOAuthCloud, openTokens, protonLinkProblem, randomToken, refreshTokens, sealTokens,
  type Capability, type CloudApi, type CloudId, type OAuthCloud, type TokenSet,
} from "@/lib/special/cloud";

type Row = { provider: string; status: string; account_label: string; scopes: string; folders: string; token_ciphertext: string | null; token_iv: string | null; expires_at: string | null; last_test: string | null; connected_at: string | null; updated_at: string };
export type CloudFolder = { id: string; name: string; path?: string | null };
export type ProtonLink = { id: string; title: string; url: string; addedAt: string };

export type CloudStatus = {
  provider: CloudId;
  label: string;
  kind: "oauth" | "manual";
  configured: boolean;
  missing: string[];
  status: "not-configured" | "not-connected" | "connected" | "error" | "manual";
  account: string;
  capabilities: Capability[];
  scopes: string[];
  permissions: Array<{ capability: Capability | "links"; text: string; granted: boolean }>;
  folders: CloudFolder[];
  links: ProtonLink[];
  connectedAt: string | null;
  lastTest: { ok: boolean; at: string; detail: string } | null;
  redirectPath: string | null;
  setup: string;
};

type Env = Record<string, string | undefined>;
const envOf = async () => (await workerEnv()) as unknown as Env;

async function rows(): Promise<Map<string, Row>> {
  const sql = await getSql();
  try {
    return new Map((await sql<Row>`select * from cloud_connections`).map((r) => [r.provider, r]));
  } catch {
    return new Map();
  }
}

const parse = <T,>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const callbackPath = (p: OAuthCloud) => `/admin/api/cloud/callback/${p}`;

export async function cloudStatuses(): Promise<CloudStatus[]> {
  const env = await envOf();
  const all = await rows();
  return CLOUD_IDS.map((id): CloudStatus => {
    const r = all.get(id);
    if (id === "proton-drive") {
      const links = parse<ProtonLink[]>(r?.folders, []);
      return { provider: id, label: PROTON.label, kind: "manual", configured: true, missing: [], status: links.length ? "manual" : "not-connected", account: "", capabilities: [], scopes: [], permissions: [{ capability: "links", text: PROTON.explain, granted: links.length > 0 }], folders: [], links, connectedAt: null, lastTest: parse(r?.last_test, null), redirectPath: null, setup: "Nothing to configure: paste share links." };
    }
    const def = PROVIDERS[id];
    const missing = [def.env.id, def.env.secret, ...(env.CLOUD_TOKEN_KEY && env.CLOUD_TOKEN_KEY.length >= 16 ? [] : ["CLOUD_TOKEN_KEY"])].filter((k) => !env[k]);
    const connected = Boolean(r && r.status === "connected" && r.token_ciphertext);
    const caps = connected ? grantedCaps(id, r!.scopes) : [];
    return {
      provider: id, label: def.label, kind: "oauth", configured: missing.length === 0, missing,
      status: missing.length ? (connected ? "error" : "not-configured") : connected ? "connected" : r?.status === "error" ? "error" : "not-connected",
      account: connected ? r!.account_label : "",
      capabilities: caps,
      scopes: connected ? r!.scopes.split(/\s+/).filter(Boolean) : [],
      permissions: (["read", "share", "upload"] as const).map((c) => ({ capability: c, text: def.explain[c], granted: caps.includes(c) })),
      folders: parse<CloudFolder[]>(r?.folders, []),
      links: [],
      connectedAt: connected ? r!.connected_at : null,
      lastTest: parse(r?.last_test, null),
      redirectPath: callbackPath(id),
      setup: def.console,
    };
  });
}

/** Connected OAuth providers (for the MCP tool list). */
export async function connectedClouds(): Promise<CloudId[]> {
  const list = await cloudStatuses().catch(() => []);
  return list.filter((s) => s.status === "connected" || s.status === "manual").map((s) => s.provider);
}

async function upsert(provider: CloudId, patch: Partial<Row>) {
  const sql = await getSql();
  const now = new Date().toISOString();
  const cur = (await rows()).get(provider);
  const next: Row = { provider, status: "disconnected", account_label: "", scopes: "", folders: "[]", token_ciphertext: null, token_iv: null, expires_at: null, last_test: null, connected_at: null, ...(cur ?? {}), ...patch, updated_at: now };
  await sql`insert into cloud_connections (provider, status, account_label, scopes, folders, token_ciphertext, token_iv, expires_at, last_test, connected_at, updated_at)
    values (${next.provider}, ${next.status}, ${next.account_label}, ${next.scopes}, ${next.folders}, ${next.token_ciphertext}, ${next.token_iv}, ${next.expires_at}, ${next.last_test}, ${next.connected_at}, ${next.updated_at})
    on conflict (provider) do update set status = excluded.status, account_label = excluded.account_label, scopes = excluded.scopes, folders = excluded.folders,
      token_ciphertext = excluded.token_ciphertext, token_iv = excluded.token_iv, expires_at = excluded.expires_at, last_test = excluded.last_test,
      connected_at = excluded.connected_at, updated_at = excluded.updated_at`;
}

function credentials(p: OAuthCloud, env: Env) {
  const def = PROVIDERS[p];
  const clientId = env[def.env.id];
  const clientSecret = env[def.env.secret];
  const key = env.CLOUD_TOKEN_KEY;
  if (!clientId || !clientSecret) throw new Error(`${def.label} is not configured: set the ${def.env.id} and ${def.env.secret} Worker secrets.`);
  if (!key || key.length < 16) throw new Error("Set the CLOUD_TOKEN_KEY Worker secret (32+ random characters) before connecting cloud storage.");
  return { clientId, clientSecret, key };
}

/** Starts OAuth: returns the provider's consent URL. State + PKCE verifier are single-use, 10 minutes. */
export async function startCloudConnect(p: OAuthCloud, origin: string, caps: Capability[]): Promise<string> {
  const env = await envOf();
  const { clientId } = credentials(p, env);
  const sql = await getSql();
  const state = randomToken(32);
  const verifier = randomToken(48);
  const old = new Date(Date.now() - 10 * 60_000).toISOString();
  await sql`delete from cloud_oauth_states where created_at < ${old}`;
  await sql`insert into cloud_oauth_states (state, provider, verifier, created_at) values (${state}, ${p + "|" + caps.join(",")}, ${verifier}, ${new Date().toISOString()})`;
  return authorizeUrl(p, { clientId, redirectUri: origin + callbackPath(p), state, verifier, caps });
}

/** OAuth callback: validates state (single-use, provider-bound, fresh), exchanges the code, seals tokens. */
export async function finishCloudConnect(p: OAuthCloud, origin: string, code: string, state: string): Promise<void> {
  const env = await envOf();
  const { clientId, clientSecret, key } = credentials(p, env);
  const sql = await getSql();
  const found = await sql<{ provider: string; verifier: string; created_at: string }>`delete from cloud_oauth_states where state = ${state} returning provider, verifier, created_at`;
  const st = found[0];
  if (!st || st.provider.split("|")[0] !== p) throw new Error("This connection link is invalid or was already used. Start again from Automation → Special.");
  if (Date.parse(st.created_at) < Date.now() - 10 * 60_000) throw new Error("The connection request expired. Start again.");
  const tokens = await exchangeCode(p, { clientId, clientSecret, code, verifier: st.verifier, redirectUri: origin + callbackPath(p) });
  const requested = st.provider.split("|")[1]?.split(",").filter(Boolean) ?? [];
  if (!tokens.scope) tokens.scope = [...PROVIDERS[p].scopes.read, ...requested.flatMap((c) => PROVIDERS[p].scopes[c as Capability] ?? [])].join(" ");
  let account = PROVIDERS[p].label;
  try {
    account = await cloudApi(p, tokens.access_token).account();
  } catch { /* label only */ }
  const sealed = await sealTokens(key, tokens, p);
  const now = new Date().toISOString();
  await upsert(p, { status: "connected", account_label: account.slice(0, 200), scopes: tokens.scope, token_ciphertext: sealed.ciphertext, token_iv: sealed.iv, expires_at: tokens.expires_at ? new Date(tokens.expires_at).toISOString() : null, connected_at: now });
}

export async function markCloudError(p: OAuthCloud, detail: string) {
  await upsert(p, { last_test: JSON.stringify({ ok: false, at: new Date().toISOString(), detail: detail.slice(0, 300) }) }).catch(() => undefined);
}

export async function disconnectCloud(p: CloudId): Promise<void> {
  const r = (await rows()).get(p);
  if (p === "proton-drive") {
    await upsert(p, { status: "disconnected", folders: "[]" });
    return;
  }
  const env = await envOf();
  if (r?.token_ciphertext && r.token_iv && env.CLOUD_TOKEN_KEY) {
    try {
      const t = await openTokens(env.CLOUD_TOKEN_KEY, { ciphertext: r.token_ciphertext, iv: r.token_iv }, p);
      const def = PROVIDERS[p];
      if (p === "google-drive" && def.revokeUrl) await fetch(`${def.revokeUrl}?token=${encodeURIComponent(t.refresh_token ?? t.access_token)}`, { method: "POST" });
      if (p === "dropbox" && def.revokeUrl) await fetch(def.revokeUrl, { method: "POST", headers: { authorization: `Bearer ${t.access_token}` } });
    } catch { /* best-effort revoke; local tokens are deleted regardless */ }
  }
  await upsert(p, { status: "disconnected", account_label: "", scopes: "", token_ciphertext: null, token_iv: null, expires_at: null, connected_at: null });
}

/** A fresh access token (refreshing + re-sealing when needed). Server-only. */
async function accessToken(p: OAuthCloud): Promise<string> {
  const env = await envOf();
  const { clientId, clientSecret, key } = credentials(p, env);
  const r = (await rows()).get(p);
  if (!r || r.status !== "connected" || !r.token_ciphertext || !r.token_iv) throw new Error(`${PROVIDERS[p].label} is not connected.`);
  let t: TokenSet = await openTokens(key, { ciphertext: r.token_ciphertext, iv: r.token_iv }, p);
  if (t.expires_at && t.expires_at < Date.now() + 60_000) {
    if (!t.refresh_token) throw new Error(`${PROVIDERS[p].label} needs to be reauthorized.`);
    try {
      t = { ...(await refreshTokens(p, { clientId, clientSecret, refreshToken: t.refresh_token })), scope: t.scope };
    } catch (error) {
      await upsert(p, { status: "error", last_test: JSON.stringify({ ok: false, at: new Date().toISOString(), detail: "Token refresh failed — reauthorize." }) });
      throw error;
    }
    const sealed = await sealTokens(key, t, p);
    await upsert(p, { token_ciphertext: sealed.ciphertext, token_iv: sealed.iv, expires_at: t.expires_at ? new Date(t.expires_at).toISOString() : null });
  }
  return t.access_token;
}

export async function cloudClient(p: OAuthCloud): Promise<{ api: CloudApi; caps: Capability[]; folders: CloudFolder[] }> {
  const token = await accessToken(p);
  const r = (await rows()).get(p)!;
  return { api: cloudApi(p, token), caps: grantedCaps(p, r.scopes), folders: parse<CloudFolder[]>(r.folders, []) };
}

export async function testCloud(p: CloudId): Promise<{ ok: boolean; detail: string }> {
  let result: { ok: boolean; detail: string };
  if (p === "proton-drive") {
    const links = parse<ProtonLink[]>((await rows()).get(p)?.folders, []);
    result = links.length ? { ok: true, detail: `${links.length} share link(s) saved. Proton files are never read by the blog.` } : { ok: false, detail: "No Proton share links saved yet." };
  } else {
    try {
      const { api, folders } = await cloudClient(p);
      const items = await api.list(folders[0]?.id ?? null);
      result = { ok: true, detail: `Listed ${items.length} item(s) in ${folders[0]?.name ?? "the root folder"}.` };
    } catch (error) {
      result = { ok: false, detail: error instanceof Error ? error.message.slice(0, 300) : "Test failed." };
    }
  }
  await upsert(p, { last_test: JSON.stringify({ ...result, at: new Date().toISOString() }) }).catch(() => undefined);
  return result;
}

export async function setCloudFolders(p: OAuthCloud, folders: CloudFolder[]): Promise<void> {
  const clean = folders.slice(0, 10).map((f) => ({ id: String(f.id).slice(0, 300), name: String(f.name).slice(0, 200), path: f.path ? String(f.path).slice(0, 500) : null }));
  await upsert(p, { folders: JSON.stringify(clean) });
}

export async function addProtonLink(title: string, url: string): Promise<ProtonLink[]> {
  const problem = protonLinkProblem(url);
  if (problem) throw new Error(problem);
  const cur = parse<ProtonLink[]>((await rows()).get("proton-drive")?.folders, []);
  if (cur.some((l) => l.url === url.trim())) return cur;
  if (cur.length >= 50) throw new Error("At most 50 Proton links.");
  const next = [...cur, { id: `pl-${randomToken(6)}`, title: title.trim().slice(0, 200) || "Proton Drive file", url: url.trim(), addedAt: new Date().toISOString() }];
  await upsert("proton-drive", { status: "manual", folders: JSON.stringify(next) });
  return next;
}

export async function removeProtonLink(id: string): Promise<ProtonLink[]> {
  const next = parse<ProtonLink[]>((await rows()).get("proton-drive")?.folders, []).filter((l) => l.id !== id);
  await upsert("proton-drive", { status: next.length ? "manual" : "disconnected", folders: JSON.stringify(next) });
  return next;
}

export async function protonLinks(): Promise<ProtonLink[]> {
  return parse<ProtonLink[]>((await rows()).get("proton-drive")?.folders, []);
}

export { isOAuthCloud };
