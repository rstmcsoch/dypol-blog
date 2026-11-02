/**
 * t173: cloud connectors (pure + injectable fetcher, testable). Google Drive,
 * OneDrive and Dropbox use OAuth 2 authorization code + PKCE with the least
 * scopes that do the job; Proton Drive has no public API, so it is manual
 * share links only. Tokens are AES-GCM encrypted with CLOUD_TOKEN_KEY and
 * never leave the server.
 */
export const CLOUD_IDS = ["google-drive", "onedrive", "dropbox", "proton-drive"] as const;
export type CloudId = (typeof CLOUD_IDS)[number];
export type OAuthCloud = Exclude<CloudId, "proton-drive">;
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export type CloudFile = { id: string; name: string; kind: "file" | "folder"; mime: string | null; size: number | null; modified: string | null; webUrl: string | null; path: string | null; parents: string[] };
export type Capability = "read" | "share" | "upload";

type ProviderDef = {
  label: string;
  authUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  env: { id: string; secret: string };
  scopes: Record<Capability, string[]>;
  extraAuth: Record<string, string>;
  /** Plain-language permission details shown before connecting. */
  explain: Record<Capability, string>;
  console: string;
};

export const PROVIDERS: Record<OAuthCloud, ProviderDef> = {
  "google-drive": {
    label: "Google Drive",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    env: { id: "GOOGLE_DRIVE_CLIENT_ID", secret: "GOOGLE_DRIVE_CLIENT_SECRET" },
    scopes: { read: ["https://www.googleapis.com/auth/drive.readonly"], share: ["https://www.googleapis.com/auth/drive.file"], upload: ["https://www.googleapis.com/auth/drive.file"] },
    extraAuth: { access_type: "offline", prompt: "consent", include_granted_scopes: "false" },
    explain: {
      read: "See and download your Drive files (read-only). Cannot change or delete anything.",
      share: "Create share links only for files this blog created (drive.file). Other files keep their existing sharing.",
      upload: "Create new files in Drive (only files this blog creates — drive.file).",
    },
    console: "Google Cloud Console → APIs & Services → Credentials → OAuth client (Web application); enable the Google Drive API.",
  },
  onedrive: {
    label: "OneDrive",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    env: { id: "ONEDRIVE_CLIENT_ID", secret: "ONEDRIVE_CLIENT_SECRET" },
    scopes: { read: ["offline_access", "Files.Read"], share: ["Files.ReadWrite"], upload: ["Files.ReadWrite"] },
    extraAuth: { response_mode: "query" },
    explain: {
      read: "Read your OneDrive files (Files.Read) and stay connected (offline_access).",
      share: "Create view-only share links (needs Files.ReadWrite — Microsoft has no narrower sharing scope).",
      upload: "Upload generated documents (Files.ReadWrite).",
    },
    console: "Microsoft Entra admin center → App registrations → New registration (any account type); add a Web redirect URI and a client secret.",
  },
  dropbox: {
    label: "Dropbox",
    authUrl: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    revokeUrl: "https://api.dropboxapi.com/2/auth/token/revoke",
    env: { id: "DROPBOX_APP_KEY", secret: "DROPBOX_APP_SECRET" },
    scopes: { read: ["files.metadata.read", "files.content.read"], share: ["sharing.write"], upload: ["files.content.write"] },
    extraAuth: { token_access_type: "offline" },
    explain: {
      read: "See file names/metadata and download file contents (read-only).",
      share: "Create shared links (sharing.write).",
      upload: "Upload generated documents (files.content.write).",
    },
    console: "Dropbox App Console → Create app (Scoped access, Full Dropbox or App folder); enable the scopes listed; add the redirect URI.",
  },
};

export const PROTON = {
  label: "Proton Drive",
  explain: "Proton Drive is end-to-end encrypted and has no public API. Paste public share links (https://drive.proton.me/urls/…); the blog only stores and shows those links — it never reads the files.",
};

export function scopesFor(p: OAuthCloud, caps: Capability[]): string[] {
  const set = new Set<string>(PROVIDERS[p].scopes.read);
  for (const c of caps) for (const s of PROVIDERS[p].scopes[c]) set.add(s);
  return [...set];
}

export function grantedCaps(p: OAuthCloud, scopes: string): Capability[] {
  const have = new Set(scopes.split(/[\s,]+/).filter(Boolean).map((s) => s.toLowerCase()));
  const has = (list: string[]) => list.every((s) => have.has(s.toLowerCase()));
  return (["read", "share", "upload"] as const).filter((c) => has(PROVIDERS[p].scopes[c]));
}

export function isOAuthCloud(v: string): v is OAuthCloud {
  return v === "google-drive" || v === "onedrive" || v === "dropbox";
}

// ---------- PKCE + state ----------

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

export async function authorizeUrl(p: OAuthCloud, o: { clientId: string; redirectUri: string; state: string; verifier: string; caps: Capability[] }): Promise<string> {
  const def = PROVIDERS[p];
  const u = new URL(def.authUrl);
  const params: Record<string, string> = {
    response_type: "code",
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    state: o.state,
    code_challenge: await pkceChallenge(o.verifier),
    code_challenge_method: "S256",
    ...def.extraAuth,
  };
  const scope = scopesFor(p, o.caps).join(" ");
  if (p === "dropbox") params.scope = scope;
  else params.scope = scope;
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

export type TokenSet = { access_token: string; refresh_token?: string; expires_at: number | null; scope: string };

export async function exchangeCode(p: OAuthCloud, o: { clientId: string; clientSecret: string; code: string; verifier: string; redirectUri: string; fetcher?: FetchFn }): Promise<TokenSet> {
  return tokenRequest(p, { grant_type: "authorization_code", code: o.code, redirect_uri: o.redirectUri, code_verifier: o.verifier }, o);
}

export async function refreshTokens(p: OAuthCloud, o: { clientId: string; clientSecret: string; refreshToken: string; fetcher?: FetchFn }): Promise<TokenSet> {
  const t = await tokenRequest(p, { grant_type: "refresh_token", refresh_token: o.refreshToken }, o);
  return { ...t, refresh_token: t.refresh_token ?? o.refreshToken };
}

async function tokenRequest(p: OAuthCloud, body: Record<string, string>, o: { clientId: string; clientSecret: string; fetcher?: FetchFn }): Promise<TokenSet> {
  const f = o.fetcher ?? fetch;
  const res = await f(PROVIDERS[p].tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ ...body, client_id: o.clientId, client_secret: o.clientSecret }).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== "string") {
    const reason = typeof json.error_description === "string" ? json.error_description : typeof json.error === "string" ? json.error : `HTTP ${res.status}`;
    throw new Error(`${PROVIDERS[p].label} refused the token request: ${String(reason).slice(0, 200)}`);
  }
  const expires = Number(json.expires_in);
  return {
    access_token: json.access_token,
    refresh_token: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    expires_at: Number.isFinite(expires) && expires > 0 ? Date.now() + expires * 1000 : null,
    scope: typeof json.scope === "string" ? json.scope : "",
  };
}

// ---------- token encryption (AES-GCM, key = SHA-256(CLOUD_TOKEN_KEY)) ----------

async function aesKey(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 16) throw new Error("CLOUD_TOKEN_KEY is missing or shorter than 16 characters.");
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealTokens(secret: string, tokens: TokenSet, aad: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, await aesKey(secret), new TextEncoder().encode(JSON.stringify(tokens)));
  return { ciphertext: btoa(String.fromCharCode(...new Uint8Array(ct))), iv: btoa(String.fromCharCode(...iv)) };
}

export async function openTokens(secret: string, sealed: { ciphertext: string; iv: string }, aad: string): Promise<TokenSet> {
  const dec = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: dec(sealed.iv), additionalData: new TextEncoder().encode(aad) }, await aesKey(secret), dec(sealed.ciphertext));
  return JSON.parse(new TextDecoder().decode(pt)) as TokenSet;
}

// ---------- Proton manual links ----------

export function protonLinkProblem(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return "Not a valid URL.";
  }
  if (u.protocol !== "https:" || u.hostname !== "drive.proton.me" || !/^\/urls\/[A-Za-z0-9_-]{6,}/.test(u.pathname)) return "Use a Proton Drive public share link (https://drive.proton.me/urls/…).";
  return null;
}

/** Best-effort provider from a URL (for resource attachments). */
export function providerOfUrl(url: string): CloudId | "link" {
  try {
    const h = new URL(url).hostname;
    if (h === "drive.google.com" || h === "docs.google.com") return "google-drive";
    if (h === "1drv.ms" || h.endsWith("onedrive.live.com") || h.endsWith(".sharepoint.com")) return "onedrive";
    if (h === "www.dropbox.com" || h === "dropbox.com" || h === "dl.dropboxusercontent.com") return "dropbox";
    if (h === "drive.proton.me") return "proton-drive";
  } catch { /* not a url */ }
  return "link";
}

// ---------- provider APIs ----------

export class CloudApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

async function jsonOrThrow(res: Response, label: string): Promise<Record<string, unknown>> {
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = json.error as { message?: string } | string | undefined;
    const msg = typeof err === "string" ? err : err?.message ?? (json.error_summary as string | undefined) ?? `HTTP ${res.status}`;
    throw new CloudApiError(`${label}: ${String(msg).slice(0, 200)}`, res.status === 401 ? 401 : 502);
  }
  return json;
}

const GOOGLE_FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink,parents";
const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

function fromGoogle(f: Record<string, unknown>): CloudFile {
  const folder = f.mimeType === "application/vnd.google-apps.folder";
  return { id: String(f.id), name: String(f.name ?? ""), kind: folder ? "folder" : "file", mime: (f.mimeType as string) ?? null, size: f.size ? Number(f.size) : null, modified: (f.modifiedTime as string) ?? null, webUrl: (f.webViewLink as string) ?? null, path: null, parents: (f.parents as string[]) ?? [] };
}
function fromGraph(f: Record<string, unknown>): CloudFile {
  const parent = f.parentReference as { id?: string; path?: string } | undefined;
  return { id: String(f.id), name: String(f.name ?? ""), kind: f.folder ? "folder" : "file", mime: ((f.file as { mimeType?: string } | undefined)?.mimeType) ?? null, size: typeof f.size === "number" ? f.size : null, modified: (f.lastModifiedDateTime as string) ?? null, webUrl: (f.webUrl as string) ?? null, path: parent?.path ? `${parent.path.replace(/^\/drive\/root:/, "")}/${String(f.name ?? "")}` : null, parents: parent?.id ? [parent.id] : [] };
}
function fromDropbox(f: Record<string, unknown>): CloudFile {
  return { id: String(f.id ?? f.path_lower), name: String(f.name ?? ""), kind: f[".tag"] === "folder" ? "folder" : "file", mime: null, size: typeof f.size === "number" ? f.size : null, modified: (f.server_modified as string) ?? null, webUrl: null, path: (f.path_display as string) ?? (f.path_lower as string) ?? null, parents: [] };
}

const GOOGLE_EXPORT: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "text/plain", ext: "txt" },
  "application/vnd.google-apps.spreadsheet": { mime: "text/csv", ext: "csv" },
  "application/vnd.google-apps.presentation": { mime: "text/plain", ext: "txt" },
};

export type CloudApi = {
  account(): Promise<string>;
  list(folderId: string | null): Promise<CloudFile[]>;
  search(query: string): Promise<CloudFile[]>;
  metadata(id: string): Promise<CloudFile>;
  download(id: string, maxBytes: number): Promise<{ bytes: Uint8Array; name: string; mime: string }>;
  shareLink(id: string): Promise<string>;
  upload(folderId: string | null, name: string, mime: string, bytes: Uint8Array): Promise<CloudFile>;
};

async function capped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new CloudApiError(`The file is larger than ${Math.round(maxBytes / 1e6)} MB.`, 413);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new CloudApiError(`The file is larger than ${Math.round(maxBytes / 1e6)} MB.`, 413);
  return buf;
}

export function cloudApi(p: OAuthCloud, token: string, fetcher: FetchFn = fetch): CloudApi {
  const auth = { authorization: `Bearer ${token}` };
  if (p === "google-drive") {
    const base = "https://www.googleapis.com/drive/v3";
    const get = async (path: string) => jsonOrThrow(await fetcher(`${base}${path}`, { headers: auth }), "Google Drive");
    return {
      account: async () => {
        const j = await get("/about?fields=user(emailAddress,displayName)");
        const u = j.user as { emailAddress?: string; displayName?: string } | undefined;
        return u?.emailAddress ?? u?.displayName ?? "Google account";
      },
      list: async (folderId) => ((await get(`/files?pageSize=100&fields=files(${GOOGLE_FIELDS})&orderBy=folder,name&q=${encodeURIComponent(`'${q(folderId ?? "root")}' in parents and trashed = false`)}`)).files as Record<string, unknown>[] ?? []).map(fromGoogle),
      search: async (query) => ((await get(`/files?pageSize=25&fields=files(${GOOGLE_FIELDS})&q=${encodeURIComponent(`(name contains '${q(query)}' or fullText contains '${q(query)}') and trashed = false`)}`)).files as Record<string, unknown>[] ?? []).map(fromGoogle),
      metadata: async (id) => fromGoogle(await get(`/files/${encodeURIComponent(id)}?fields=${GOOGLE_FIELDS}`)),
      download: async (id, maxBytes) => {
        const meta = fromGoogle(await get(`/files/${encodeURIComponent(id)}?fields=${GOOGLE_FIELDS}`));
        if (meta.kind === "folder") throw new CloudApiError("That is a folder.", 400);
        const exp = meta.mime ? GOOGLE_EXPORT[meta.mime] : undefined;
        if (meta.mime?.startsWith("application/vnd.google-apps.") && !exp) throw new CloudApiError("This Google file type cannot be exported as text.", 415);
        const url = exp ? `${base}/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(exp.mime)}` : `${base}/files/${encodeURIComponent(id)}?alt=media`;
        const res = await fetcher(url, { headers: auth });
        if (!res.ok) throw new CloudApiError(`Google Drive download failed (HTTP ${res.status}).`);
        return { bytes: await capped(res, maxBytes), name: exp ? `${meta.name}.${exp.ext}` : meta.name, mime: exp?.mime ?? meta.mime ?? "application/octet-stream" };
      },
      shareLink: async (id) => {
        const res = await fetcher(`${base}/files/${encodeURIComponent(id)}/permissions`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ role: "reader", type: "anyone" }) });
        if (!res.ok) throw new CloudApiError(res.status === 403 || res.status === 404 ? "Google only lets this blog share files it created (drive.file). Share the file in Drive yourself, then attach its link." : `Google Drive sharing failed (HTTP ${res.status}).`, res.status);
        return fromGoogle(await get(`/files/${encodeURIComponent(id)}?fields=${GOOGLE_FIELDS}`)).webUrl ?? `https://drive.google.com/file/d/${id}/view`;
      },
      upload: async (folderId, name, mime, bytes) => {
        const boundary = `dypol${randomToken(8)}`;
        const meta = JSON.stringify({ name, ...(folderId ? { parents: [folderId] } : {}) });
        const head = new TextEncoder().encode(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`);
        const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
        const body = new Uint8Array(head.length + bytes.length + tail.length);
        body.set(head); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
        const res = await fetcher(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${GOOGLE_FIELDS}`, { method: "POST", headers: { ...auth, "content-type": `multipart/related; boundary=${boundary}` }, body });
        return fromGoogle(await jsonOrThrow(res, "Google Drive upload"));
      },
    };
  }
  if (p === "onedrive") {
    const base = "https://graph.microsoft.com/v1.0/me/drive";
    const sel = "$select=id,name,size,file,folder,lastModifiedDateTime,webUrl,parentReference";
    const get = async (path: string) => jsonOrThrow(await fetcher(`${base}${path}`, { headers: auth }), "OneDrive");
    return {
      account: async () => {
        const j = await get("?$select=owner");
        return ((j.owner as { user?: { displayName?: string } } | undefined)?.user?.displayName) ?? "Microsoft account";
      },
      list: async (folderId) => ((await get(`${folderId ? `/items/${encodeURIComponent(folderId)}` : "/root"}/children?${sel}&$top=100`)).value as Record<string, unknown>[] ?? []).map(fromGraph),
      search: async (query) => ((await get(`/root/search(q='${encodeURIComponent(query.replace(/'/g, "''"))}')?${sel}&$top=25`)).value as Record<string, unknown>[] ?? []).map(fromGraph),
      metadata: async (id) => fromGraph(await get(`/items/${encodeURIComponent(id)}?${sel}`)),
      download: async (id, maxBytes) => {
        const meta = fromGraph(await get(`/items/${encodeURIComponent(id)}?${sel}`));
        if (meta.kind === "folder") throw new CloudApiError("That is a folder.", 400);
        // Graph answers 302 to a pre-authenticated URL: follow it WITHOUT the bearer token.
        const first = await fetcher(`${base}/items/${encodeURIComponent(id)}/content`, { headers: auth, redirect: "manual" });
        const loc = first.headers.get("location");
        const res = loc ? await fetcher(loc, { redirect: "follow" }) : first;
        if (!res.ok) throw new CloudApiError(`OneDrive download failed (HTTP ${res.status}).`);
        return { bytes: await capped(res, maxBytes), name: meta.name, mime: meta.mime ?? "application/octet-stream" };
      },
      shareLink: async (id) => {
        const j = await jsonOrThrow(await fetcher(`${base}/items/${encodeURIComponent(id)}/createLink`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ type: "view", scope: "anonymous" }) }), "OneDrive sharing");
        const url = (j.link as { webUrl?: string } | undefined)?.webUrl;
        if (!url) throw new CloudApiError("OneDrive returned no link.");
        return url;
      },
      upload: async (folderId, name, mime, bytes) => {
        if (bytes.byteLength > 4_000_000) throw new CloudApiError("OneDrive simple upload is limited to 4 MB.", 413);
        const target = `${folderId ? `/items/${encodeURIComponent(folderId)}` : "/root"}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=rename`;
        return fromGraph(await jsonOrThrow(await fetcher(`${base}${target}`, { method: "PUT", headers: { ...auth, "content-type": mime }, body: bytes as unknown as BodyInit }), "OneDrive upload"));
      },
    };
  }
  // dropbox
  const rpc = async (path: string, body: unknown) => jsonOrThrow(await fetcher(`https://api.dropboxapi.com/2${path}`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) }), "Dropbox");
  const ref = (id: string) => (id.startsWith("id:") || id.startsWith("/") ? id : `/${id}`);
  return {
    account: async () => "Dropbox account",
    list: async (folderId) => ((await rpc("/files/list_folder", { path: folderId ? ref(folderId) : "", limit: 100 })).entries as Record<string, unknown>[] ?? []).map(fromDropbox),
    search: async (query) => ((await rpc("/files/search_v2", { query, options: { max_results: 25 } })).matches as Array<{ metadata?: { metadata?: Record<string, unknown> } }> ?? []).map((m) => m.metadata?.metadata).filter((m): m is Record<string, unknown> => Boolean(m)).map(fromDropbox),
    metadata: async (id) => fromDropbox(await rpc("/files/get_metadata", { path: ref(id) })),
    download: async (id, maxBytes) => {
      const res = await fetcher("https://content.dropboxapi.com/2/files/download", { method: "POST", headers: { ...auth, "Dropbox-API-Arg": JSON.stringify({ path: ref(id) }).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`) } });
      if (!res.ok) throw new CloudApiError(`Dropbox download failed (HTTP ${res.status}).`);
      const meta = JSON.parse(res.headers.get("dropbox-api-result") ?? "{}") as { name?: string };
      return { bytes: await capped(res, maxBytes), name: meta.name ?? "file", mime: res.headers.get("content-type") ?? "application/octet-stream" };
    },
    shareLink: async (id) => {
      const res = await fetcher("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ path: ref(id), settings: { requested_visibility: "public", audience: "public", access: "viewer" } }) });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: { shared_link_already_exists?: { metadata?: { url?: string } } } };
      if (res.ok && j.url) return j.url;
      const existing = j.error?.shared_link_already_exists?.metadata?.url;
      if (existing) return existing;
      throw new CloudApiError(`Dropbox sharing failed (HTTP ${res.status}).`);
    },
    upload: async (folderId, name, _mime, bytes) => {
      const path = `${folderId ? ref(folderId).replace(/\/$/, "") : ""}/${name}`;
      const res = await fetcher("https://content.dropboxapi.com/2/files/upload", { method: "POST", headers: { ...auth, "content-type": "application/octet-stream", "Dropbox-API-Arg": JSON.stringify({ path, mode: "add", autorename: true }) }, body: bytes as unknown as BodyInit });
      return fromDropbox(await jsonOrThrow(res, "Dropbox upload"));
    },
  };
}

/** Folder restriction: with selected folders, a file must sit inside one of them. */
export function insideFolders(file: CloudFile, folders: Array<{ id: string; path?: string | null }>, ancestors: string[] = []): boolean {
  if (!folders.length) return true;
  return folders.some((f) => f.id === file.id || file.parents.includes(f.id) || ancestors.includes(f.id) || (f.path && file.path ? file.path.toLowerCase().startsWith(f.path.toLowerCase().replace(/\/?$/, "/")) : false));
}
