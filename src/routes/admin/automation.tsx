import { useEffect, useState } from "react";
import { adminPending } from "@/components/admin/pending";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import { adminAutomation, adminProfileAction, adminSaveAutomation } from "@/content/admin-api";
import { SERVER_API_PROVIDERS, type AutomationSettings } from "@/lib/automation/settings";
import { PROVIDER_KEY_SECRETS, PROVIDER_LABELS } from "@/lib/automation/provider";
import { nextExpectedRun } from "@/lib/automation/schedule";
import { checkAuthorName, sameAuthor } from "@/lib/author-name";

export const Route = createFileRoute("/admin/automation")({
  ...adminPending,
  validateSearch: (search: Record<string, unknown>): { profile?: string } =>
    typeof search.profile === "string" && /^(default|p[0-9a-f]{8})$/.test(search.profile) ? { profile: search.profile } : {},
  loaderDeps: ({ search }) => ({ profile: search.profile }),
  loader: ({ deps }) => adminAutomation({ data: { profileId: deps.profile ?? "default" } }),
  component: AutomationPage,
});

function AutomationPage() {
  const data = Route.useLoaderData();
  return (
    <>
      <Profiles />
      <AutomationDesk key={data.profileId} />
    </>
  );
}

/** Named automation profiles. Each AI app connects with an API key, an OAuth client, or both. */
function Profiles() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const [name, setName] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [connect, setConnect] = useState<"api-key" | "oauth">("api-key");
  const [redirects, setRedirects] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<
    | { kind: "token"; token: string }
    | { kind: "oauth"; clientId: string; clientSecret: string; redirectUris: string[] }
    | null
  >(null);
  const [oauthFor, setOauthFor] = useState<string | null>(null);
  const [oauthRedirects, setOauthRedirects] = useState("");
  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    return fn()
      .then(() => router.invalidate())
      .catch((caught: unknown) => setError(errorText(caught)))
      .finally(() => setBusy(false));
  };
  const editingOauth = data.profiles.find((p) => p.id === oauthFor) ?? null;
  return (
    <section className="block-card" aria-labelledby="profiles-h" style={{ marginBottom: "1.5rem" }}>
      <h2 id="profiles-h" className="desk-kicker">Automation profiles</h2>
      <p className="desk-note">
        Several profiles can be on at the same time, each run by its own AI app on that app's schedule. Each profile is one automation (for example &ldquo;Gemini daily tech&rdquo; or &ldquo;Claude weekly design&rdquo;) with its own
        on/off switch, topics, publishing rules and daily limit. The master MCP_TOKEN secret keeps working and acts as the Default profile.
      </p>
      <p className="desk-note">
        Two ways to connect, and a profile can have both. <strong>API key</strong>: paste a bearer token into the AI app (<code>Authorization: Bearer …</code>). <strong>OAuth client</strong>: for apps that ask for a client ID and client secret, such as Gemini's custom connector. Paste the redirect URL the app shows (Gemini: Copy redirect URL), then copy the ID and secret back into the app. The MCP address is this site's <code>/mcp</code>.
      </p>
      {error ? <p className="banner banner--bad" role="alert">{error}</p> : null}
      {shown?.kind === "token" ? (
        <div className="banner" role="status" data-testid="new-token">
          <p style={{ margin: 0 }}>
            New API key, shown <strong>once</strong>. Copy it into the AI app as a bearer token, or paste it on the connector approval page. Only a fingerprint is stored.
          </p>
          <code style={{ display: "block", wordBreak: "break-all", margin: "0.5rem 0" }}>{shown.token}</code>
          <button type="button" className="btn btn--ghost" onClick={() => void navigator.clipboard?.writeText(shown.token)}>Copy</button>{" "}
          <button type="button" className="btn btn--ghost" onClick={() => setShown(null)}>I've saved it</button>
        </div>
      ) : null}
      {shown?.kind === "oauth" ? (
        <div className="banner" role="status" data-testid="new-oauth">
          <p style={{ margin: 0 }}>
            OAuth client secret, shown <strong>once</strong>. In the AI app, set the MCP server URL to this site's <code>/mcp</code>, then paste the client ID and secret. The redirect URL must be exactly one you saved. Only a hash of the secret is stored.
          </p>
          <p style={{ margin: "0.5rem 0 0" }}>Client ID</p>
          <code style={{ display: "block", wordBreak: "break-all", margin: "0.25rem 0 0.5rem" }}>{shown.clientId}</code>
          <button type="button" className="btn btn--ghost" onClick={() => void navigator.clipboard?.writeText(shown.clientId)}>Copy client ID</button>
          <p style={{ margin: "0.75rem 0 0" }}>Client secret</p>
          <code style={{ display: "block", wordBreak: "break-all", margin: "0.25rem 0 0.5rem" }}>{shown.clientSecret}</code>
          <button type="button" className="btn btn--ghost" onClick={() => void navigator.clipboard?.writeText(shown.clientSecret)}>Copy secret</button>{" "}
          <button type="button" className="btn btn--ghost" onClick={() => setShown(null)}>I've saved it</button>
          <p className="desk-note" style={{ marginBottom: 0 }}>Saved redirect {shown.redirectUris.length === 1 ? "URL" : "URLs"}: {shown.redirectUris.join(", ")}</p>
        </div>
      ) : null}
      <div className="adm-scroll-x"><table className="desk-table">
        <thead><tr><th>Profile</th><th>Author name</th><th>Status</th><th>API key</th><th>OAuth</th><th>Actions</th></tr></thead>
        <tbody>
          {data.profiles.map((p) => (
            <tr key={p.id} aria-current={p.id === data.profileId ? "true" : undefined} style={p.id === data.profileId ? { fontWeight: 650 } : undefined}>
              <td>{p.name}</td>
              <td><AuthorCell profileId={p.id} profileName={p.name} initial={p.authorName ?? ""} others={data.profiles.filter((o) => o.id !== p.id)} onSaved={() => router.invalidate()} /></td>
              <td>{!p.enabled ? "Off" : p.paused ? "Paused" : "On"}</td>
              <td>{p.isDefault ? "MCP_TOKEN secret" : p.hasToken ? `…${p.tokenHint ?? ""}` : "none"}</td>
              <td>{p.oauth ? <span title={p.oauth.redirectUris.join("\n")}>{p.oauth.clientId.slice(0, 10)}… secret …{p.oauth.secretHint ?? ""}</span> : "none"}</td>
              <td style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                <button type="button" className="btn btn--ghost" disabled={p.id === data.profileId} onClick={() => void navigate({ search: { profile: p.id } })}>
                  {p.id === data.profileId ? "Editing" : "Edit"}
                </button>
                <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => { setOauthFor(p.id); setOauthRedirects(p.oauth?.redirectUris.join("\n") ?? ""); }}>
                  {p.oauth ? "OAuth settings" : "Add OAuth"}
                </button>
                {p.isDefault ? null : (
                  <>
                    <button type="button" className="btn btn--ghost" disabled={busy}
                      onClick={() => {
                        if (p.hasToken && !window.confirm("Replace the API key? The old one (and apps signed in with it) stop working. An OAuth client on this profile is not affected.")) return;
                        void run(async () => {
                          const r = await adminProfileAction({ data: { action: "token", profileId: p.id } });
                          if ("token" in r && r.token) setShown({ kind: "token", token: r.token });
                        });
                      }}>
                      {p.hasToken ? "New API key" : "Create API key"}
                    </button>
                    {p.hasToken ? (
                      <button type="button" className="btn btn--ghost" disabled={busy}
                        onClick={() => window.confirm("Revoke this API key? Apps using it lose access immediately. An OAuth client on this profile keeps working.") && void run(() => adminProfileAction({ data: { action: "revoke", profileId: p.id } }))}>
                        Revoke key
                      </button>
                    ) : null}
                    <button type="button" className="btn btn--ghost" disabled={busy}
                      onClick={() => {
                        const next = window.prompt("New name", p.name);
                        if (next) void run(() => adminProfileAction({ data: { action: "rename", profileId: p.id, name: next } }));
                      }}>
                      Rename
                    </button>
                    <button type="button" className="btn btn--danger" disabled={busy}
                      onClick={() =>
                        window.confirm(`Delete “${p.name}”? Its API key and OAuth client stop working. Its drafts and run history are kept.`) &&
                        void run(async () => {
                          await adminProfileAction({ data: { action: "delete", profileId: p.id } });
                          if (p.id === data.profileId) await navigate({ search: {} });
                          if (oauthFor === p.id) setOauthFor(null);
                        })
                      }>
                      Delete
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {editingOauth ? (
        <form
          className="stack"
          style={{ marginTop: "0.75rem" }}
          data-testid="oauth-panel"
          onSubmit={(e) => {
            e.preventDefault();
            const uris = lines(oauthRedirects);
            const exists = Boolean(editingOauth.oauth);
            if (exists && !window.confirm("Replace the client secret? The old secret stops working, and this AI app must be updated. Redirect URLs are saved with it.")) return;
            void run(async () => {
              const r = await adminProfileAction({ data: { action: "oauth-create", profileId: editingOauth.id, redirectUris: uris } });
              if ("oauth" in r && r.oauth) setShown({ kind: "oauth", clientId: r.oauth.clientId, clientSecret: r.oauth.clientSecret, redirectUris: r.oauth.redirectUris });
            });
          }}
        >
          <p className="desk-note" style={{ marginBottom: 0 }}>
            OAuth for <strong>{editingOauth.name}</strong>. Paste the exact redirect URL from the AI app (one per line, up to 5). Do not invent it — Gemini shows it under Copy redirect URL, usually <code>https://oauth-redirect.googleusercontent.com/r/…</code>. The authorization code is sent to that URL, so only paste one from an app you trust.
            {editingOauth.oauth ? <> Client ID (not secret, copy any time): <code>{editingOauth.oauth.clientId}</code>.</> : null}
          </p>
          <label className="field"><span>Redirect URLs</span>
            <textarea value={oauthRedirects} onChange={(e) => setOauthRedirects(e.target.value)} placeholder={"https://oauth-redirect.googleusercontent.com/r/…"} data-testid="oauth-redirects" />
          </label>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            <button className="btn" type="submit" disabled={busy || lines(oauthRedirects).length < 1}>{editingOauth.oauth ? "Rotate secret" : "Create OAuth client"}</button>
            {editingOauth.oauth ? (
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void run(() => adminProfileAction({ data: { action: "oauth-redirects", profileId: editingOauth.id, redirectUris: lines(oauthRedirects) } }))}>
                Save redirect URLs only
              </button>
            ) : null}
            {editingOauth.oauth ? (
              <button type="button" className="btn btn--danger" disabled={busy}
                onClick={() => window.confirm("Remove this OAuth client? Apps using its secret lose access immediately. The API key is not affected.") && void run(async () => { await adminProfileAction({ data: { action: "oauth-revoke", profileId: editingOauth.id } }); setOauthFor(null); })}>
                Remove OAuth
              </button>
            ) : null}
            <button type="button" className="btn btn--ghost" onClick={() => setOauthFor(null)}>Close</button>
          </div>
        </form>
      ) : null}
      <form
        className="stack"
        style={{ marginTop: "0.75rem" }}
        onSubmit={(e) => {
          e.preventDefault();
          const uris = lines(redirects);
          if (connect === "oauth" && uris.length < 1) {
            setError("Paste the redirect URL from the AI app before creating an OAuth profile.");
            return;
          }
          void run(async () => {
            const r = await adminProfileAction({ data: connect === "oauth" ? { action: "create", name, connect, redirectUris: uris, authorName } : { action: "create", name, connect: "api-key", authorName } });
            setName("");
            setAuthorName("");
            setRedirects("");
            if ("token" in r && r.token) setShown({ kind: "token", token: r.token });
            if ("oauth" in r && r.oauth) setShown({ kind: "oauth", clientId: r.oauth.clientId, clientSecret: r.oauth.clientSecret, redirectUris: r.oauth.redirectUris });
            if ("profile" in r && r.profile) await navigate({ search: { profile: r.profile.id } });
          });
        }}
      >
        <label className="field"><span>New profile name</span><input value={name} maxLength={60} placeholder="Gemini daily tech" onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Author name (byline on this profile's articles)</span><input value={authorName} maxLength={60} placeholder="John Daniel" data-testid="new-profile-author" onChange={(e) => setAuthorName(e.target.value)} />
          {authorError(authorName, data.profiles) ? <small className="author-cell__error" role="alert">{authorError(authorName, data.profiles)}</small> : null}
        </label>
        <fieldset className="field">
          <legend>How should this AI app connect?</legend>
          <label style={checkRow}><input style={{ width: "auto" }} type="radio" name="connect-method" checked={connect === "api-key"} onChange={() => setConnect("api-key")} /> API key (bearer token)</label>
          <label style={checkRow}><input style={{ width: "auto" }} type="radio" name="connect-method" checked={connect === "oauth"} onChange={() => setConnect("oauth")} /> OAuth client ID and secret</label>
        </fieldset>
        {connect === "oauth" ? (
          <label className="field"><span>Redirect URL from the AI app (one per line)</span>
            <textarea value={redirects} onChange={(e) => setRedirects(e.target.value)} placeholder="Paste the redirect URL from the AI app" />
          </label>
        ) : <p className="desk-note">An API key is created with the profile and shown once. You can add an OAuth client later from the same row.</p>}
        <button className="btn" type="submit" disabled={busy || name.trim().length < 2 || Boolean(authorError(authorName, data.profiles))}>Add profile</button>
      </form>
    </section>
  );
}

type ProfileLite = { id: string; name: string; authorName: string | null };

/** Client-side mirror of src/lib/author-name.ts (server re-checks everything). */
function authorError(value: string, others: ProfileLite[]): string | null {
  const r = checkAuthorName(value);
  if (!r.ok) return r.error;
  const taken = r.value ? others.find((o) => sameAuthor(o.authorName, r.value)) : undefined;
  return taken ? `“${taken.name}” already uses this author name.` : null;
}

/** t141: inline author-name editor for one profile row. */
function AuthorCell(props: { profileId: string; profileName: string; initial: string; others: ProfileLite[]; onSaved: () => unknown }) {
  const [value, setValue] = useState(props.initial);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setValue(props.initial), [props.initial]);
  const localError = authorError(value, props.others);
  const dirty = value.trim() !== props.initial.trim();
  const error = localError ?? serverError;
  return (
    <form
      className="author-cell"
      data-testid={`author-${props.profileId}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (localError || !dirty) return;
        setBusy(true);
        setServerError(null);
        setSaved(false);
        adminProfileAction({ data: { action: "author", profileId: props.profileId, authorName: value } })
          .then(async () => { setSaved(true); await props.onSaved(); })
          .catch((caught: unknown) => setServerError(errorText(caught)))
          .finally(() => setBusy(false));
      }}
    >
      <input
        aria-label={`Author name for ${props.profileName}`}
        value={value}
        maxLength={60}
        placeholder="DYPOL LABS"
        aria-invalid={error ? true : undefined}
        onChange={(e) => { setValue(e.target.value); setSaved(false); setServerError(null); }}
      />
      <button type="submit" className="btn" disabled={busy || !dirty || Boolean(localError)} title={dirty ? "Save this author name" : "Type a name, then Save"}>{busy ? "Saving…" : "Save"}</button>
      {error ? <small className="author-cell__error" role="alert">{error}</small> : saved ? <small className="author-cell__ok" role="status">Saved ✓ bylines updated</small> : null}
    </form>
  );
}

const lines = (value: string) => value.split("\n").map((v) => v.trim()).filter(Boolean);

function AutomationDesk() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [s, setS] = useState<AutomationSettings>(data.settings);
  const [ideas, setIdeas] = useState(data.settings.topicIdeas.join("\n"));
  const [sources, setSources] = useState(data.settings.topicSources.join("\n"));
  const [hosts, setHosts] = useState(data.settings.extraClientHosts.join("\n"));
  const api = s.serverApi;
  const setApi = (next: Partial<AutomationSettings["serverApi"]>) => setS((c) => ({ ...c, serverApi: { ...c.serverApi, ...next } }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const policy = s.policy;
  const setPolicy = (next: Partial<AutomationSettings["policy"]>) => setS((c) => ({ ...c, policy: { ...c.policy, ...next } }));
  const isDefault = data.profileId === "default";
  const nextRun = nextExpectedRun(s.schedule);
  const current = data.profiles.find((p) => p.id === data.profileId);
  const profileName = current?.name ?? "";
  const savedAuthor = current?.authorName ?? "";
  const [author, setAuthor] = useState(savedAuthor);
  useEffect(() => setAuthor(savedAuthor), [savedAuthor]);
  const authorProblem = authorError(author, data.profiles.filter((o) => o.id !== data.profileId));

  return (
    <>
      <p className="desk-kicker">AI connector</p>
      <h1 className="desk-title">Automation: {profileName}</h1>
      <p className="desk-note">
        Any AI app that supports MCP connectors (Claude, ChatGPT, Grok, Cursor, Claude Code, Gemini CLI, VS Code, ...) drafts
        articles through this site&apos;s MCP endpoint (<code>/mcp</code>). The schedule is configured in your AI app, not here.
        MCP token: {data.mcpTokenConfigured ? "configured" : "not set (endpoint disabled)"}. Active mode: {data.provider.active}.{" "}
        {data.provider.note}
      </p>
      <p className="desk-note">
        AI key secrets configured: {data.provider.configuredKeys.length ? data.provider.configuredKeys.join(", ") : "none"} (names only).
      </p>
      {error ? <p className="banner banner--bad" role="alert">{error}</p> : null}
      {message ? <p className="banner" role="status">{message}</p> : null}
      <form
        className="stack"
        style={{ marginTop: "1rem" }}
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setError(null);
          setMessage(null);
          if (authorProblem) { setError(authorProblem); setPending(false); return; }
          const authorChanged = author.trim() !== savedAuthor.trim();
          void adminSaveAutomation({ data: { profileId: data.profileId, settings: { ...s, topicIdeas: lines(ideas), topicSources: lines(sources), extraClientHosts: lines(hosts) } } })
            .then(async () => {
              let note = "";
              if (authorChanged) {
                const r = await adminProfileAction({ data: { action: "author", profileId: data.profileId, authorName: author } });
                const stored = "authorName" in r ? r.authorName : null;
                note = stored ? ` Author name saved: articles from this profile now show “by ${stored}”.` : " Author name cleared: articles from this profile show “by DYPOL LABS”.";
              }
              setMessage(`Saved.${note || " Automation settings saved."}`);
              await router.invalidate();
            })
            .catch((caught: unknown) => setError(errorText(caught)))
            .finally(() => setPending(false));
        }}
      >
        <fieldset className="block-card">
          <legend>Status</legend>
          <label className="field">
            <span>Author name (byline on this profile&apos;s articles, new and existing)</span>
            <input value={author} maxLength={60} placeholder="DYPOL LABS" data-testid="profile-author" aria-invalid={authorProblem ? true : undefined} onChange={(e) => { setAuthor(e.target.value); setMessage(null); }} />
            {authorProblem ? <small className="author-cell__error" role="alert">{authorProblem}</small> : <small className="field-help">Empty = “by DYPOL LABS”. Saved with the “Save automation” button below.</small>}
          </label>
          <Check checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} label="Enabled" />
          <Check checked={s.paused} onChange={(e) => setS({ ...s, paused: e.target.checked })} label="Paused" />
          {isDefault ? (<>
          <label className="field">
            <span>AI mode</span>
            <select value={s.mode} onChange={(e) => setS({ ...s, mode: e.target.value as AutomationSettings["mode"] })}>
              <option value="mcp-connector">mcp-connector (your AI app calls this site&apos;s tools)</option>
              <option value="server-api">server-api (site calls an AI API; needs a key secret; no scheduler yet)</option>
            </select>
          </label>
          <label className="field">
            <span>Server API provider</span>
            <select value={api.provider} onChange={(e) => setApi({ provider: e.target.value as AutomationSettings["serverApi"]["provider"] })}>
              {SERVER_API_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]} (key: {PROVIDER_KEY_SECRETS[p].join(" or ")})
                </option>
              ))}
            </select>
          </label>
          <div className="filters">
            <label className="field"><span>Model (empty = default)</span><input value={api.model} onChange={(e) => setApi({ model: e.target.value })} /></label>
            {api.provider === "openai-compatible" ? (
              <label className="field"><span>Base URL (https)</span><input value={api.baseUrl} placeholder="https://api.example.com/v1" onChange={(e) => setApi({ baseUrl: e.target.value })} /></label>
            ) : null}
          </div>
          <p className="desk-note">
            {data.provider.serverApi.label}: {data.provider.serverApi.ready ? `key ${data.provider.serverApi.keySecret} is set` : "no key secret set"}. Keys are
            only ever Worker secrets, never typed here.
          </p>
          </>) : <p className="desk-note">AI mode and server API keys are site-wide; change them on the Default profile.</p>}
          <label className="field">
            <span>Featured image transfer from your AI app (a note for yourself; it does not change behaviour)</span>
            <select value={s.imageTransfer} onChange={(e) => setS({ ...s, imageTransfer: e.target.value as AutomationSettings["imageTransfer"] })}>
              <option value="untested">Untested (verify once in your AI app)</option>
              <option value="verified">Verified working</option>
              <option value="unsupported">Unsupported (upload in Media)</option>
            </select>
          </label>
        </fieldset>
        <fieldset className="block-card">
          <legend>Topic sources</legend>
          <label className="field"><span>Topic ideas (one per line, up to 500)</span><textarea value={ideas} onChange={(e) => setIdeas(e.target.value)} /></label>
          <p className="desk-note" data-testid="topic-idea-count">{ideas.split("\n").filter((x) => x.trim()).length} / 500 ideas</p>
          <label className="field"><span>Source sites to research (https URLs, one per line)</span><textarea value={sources} onChange={(e) => setSources(e.target.value)} /></label>
        </fieldset>
        {isDefault ? <fieldset className="block-card">
          <legend>Other AI clients</legend>
          <p className="desk-note">
            Claude, ChatGPT, Grok, Cursor, VS Code, Perplexity, Gemini and desktop/CLI apps (loopback) are allowed already. Add the host of any
            other MCP client&apos;s OAuth callback here (one per line, e.g. connectors.example.com). For one app that gives you a redirect URL, use that profile's OAuth client instead of adding a whole host.
          </p>
          <label className="field"><span>Extra client hosts</span><textarea value={hosts} onChange={(e) => setHosts(e.target.value)} /></label>
        </fieldset> : null}
        <fieldset className="block-card">
          <legend>How topics are chosen</legend>
          <label className="field">
            <span>Topic choice</span>
            <select value={s.topicSelection.mode} onChange={(e) => setS({ ...s, topicSelection: { ...s.topicSelection, mode: e.target.value as AutomationSettings["topicSelection"]["mode"] } })} data-testid="topic-mode">
              <option value="trend-first">Trend first — research what is hot now, then write</option>
              <option value="random">Random — pick randomly from my idea list</option>
              <option value="sequence">In order (loop) — work through my list in order</option>
              <option value="ai-choice">Let AI choose — from my list and its own research</option>
            </select>
          </label>
          {s.topicSelection.mode === "sequence" ? (
            <>
              <label className="field"><span>Take every Nth idea (step 1–20). Step 1 = next idea, step 3 = every 3rd idea, looping back to the start.</span>
                <input type="number" min={1} max={20} value={s.topicSelection.step} onChange={(e) => setS({ ...s, topicSelection: { ...s.topicSelection, step: Number(e.target.value) } })} data-testid="topic-step" /></label>
              <p className="desk-note" data-testid="next-topic">Next topic in order: {(() => { const list = ideas.split("\n").map((x) => x.trim()).filter(Boolean); if (!list.length) return "your list is empty"; const idx = ((data.topicCursor % list.length) + list.length) % list.length; return `#${idx + 1} “${list[idx]}”`; })()}. The position only moves when an AI draft actually uses a topic.</p>
            </>
          ) : null}
          {s.topicSelection.mode === "random" ? <p className="desk-note">Each time the AI connects, the site suggests one random idea from your list.</p> : null}
          {s.topicSelection.mode === "trend-first" ? (
            <div className="field">
              <span>Look for trends on</span>
              {([["google-news", "Google News"], ["web", "Web / news sites"], ["x", "X (Twitter)"], ["social", "Other social media"]] as const).map(([v, label]) => (
                <label key={v} style={checkRow}><input style={{ width: "auto" }} type="checkbox" checked={s.topicSelection.trendSources.includes(v)} onChange={(e) => setS({ ...s, topicSelection: { ...s.topicSelection, trendSources: e.target.checked ? [...s.topicSelection.trendSources, v] : s.topicSelection.trendSources.filter((x) => x !== v) } })} /> {label}</label>
              ))}
            </div>
          ) : null}
          <label className="field">
            <span>If there is no usable topic (list empty, or no trend fits)</span>
            <select value={s.topicSelection.fallback} onChange={(e) => setS({ ...s, topicSelection: { ...s.topicSelection, fallback: e.target.value as AutomationSettings["topicSelection"]["fallback"] } })}>
              <option value="use-ideas">Use my idea list</option>
              <option value="ai-choice">Let the AI choose freely</option>
              <option value="skip">Skip this run (write nothing)</option>
            </select>
          </label>
        </fieldset>
        <fieldset className="block-card">
          <legend>When this automation runs (set in your AI app)</legend>
          <p className="desk-note">
            This website does <strong>not</strong> run automations by itself and has no scheduler. Each profile is run by its own AI app
            (Grok Automation, a Claude scheduled task, or a cron job with a CLI) using that profile&apos;s own token. Put the times below
            into that AI app so they match. Several profiles can be switched on at the same time — each keeps its own settings, daily
            limit and run log.
          </p>
          <div className="filters">
            <label className="field"><span>Timezone (e.g. Asia/Kolkata)</span><input value={s.schedule.timezone} onChange={(e) => setS({ ...s, schedule: { ...s.schedule, timezone: e.target.value } })} /></label>
            <label className="field"><span>Run times in your AI app (HH:MM, comma separated)</span><input value={s.schedule.times.join(", ")} placeholder="08:00" onChange={(e) => setS({ ...s, schedule: { ...s.schedule, times: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) as AutomationSettings["schedule"]["times"] } })} /></label>
          </div>
          <div className="field">
            <span>Days (none ticked = every day)</span>
            {(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((d) => (
              <label key={d} style={checkRow}>
                <input style={{ width: "auto" }} type="checkbox" checked={s.schedule.days.includes(d)} onChange={(e) => setS({ ...s, schedule: { ...s.schedule, days: e.target.checked ? [...s.schedule.days, d] : s.schedule.days.filter((x) => x !== d) } })} /> {d}
              </label>
            ))}
          </div>
          <p className="desk-note" data-testid="next-expected-run">
            {nextRun ? `Next expected run (from the times above, in ${s.schedule.timezone}): ${nextRun.toLocaleString("en-IN", { timeZone: s.schedule.timezone })} — this is when your AI app should connect; the website does not start it.` : "Add a run time above to see the next expected run. The website does not start runs itself."}
          </p>
          <p className="desk-note">
            Could the website run profiles itself? Only in server-api mode with an AI key secret and a Cloudflare Cron Trigger. That is
            not switched on: it would need cost limits and a separate review, so for now scheduling stays in your AI app.
          </p>
        </fieldset>
        <fieldset className="block-card">
          <legend>Publishing policy</legend>
          <p className="desk-note">Off by default: every AI article stays a draft. Turn on only with explicit rules.</p>
          <Check checked={policy.autoPublish} onChange={(e) => setPolicy({ autoPublish: e.target.checked })} label="Allow automatic publishing" />
          {policy.autoPublish && policy.allowedCategoryIds.length === 0 ? (
            <p className="desk-note" data-testid="no-topics-warning">
              No topic is ticked below, so this automation may publish into <strong>any</strong> topic. Tick topics only if you
              want to limit it. (An article with several topics may be published if any one of them is ticked.)
            </p>
          ) : null}
          <div className="field">
            <span>Topics automation may publish into</span>
            {data.categories.map((c) => (
              <label key={c.id} style={checkRow}>
                <input style={{ width: "auto" }}
                  type="checkbox"
                  checked={policy.allowedCategoryIds.includes(c.id)}
                  onChange={(e) =>
                    setPolicy({
                      allowedCategoryIds: e.target.checked
                        ? [...policy.allowedCategoryIds, c.id]
                        : policy.allowedCategoryIds.filter((id) => id !== c.id),
                    })
                  }
                />{" "}
                {c.label}
              </label>
            ))}
          </div>
          <div className="filters">
            <label className="field"><span>Minimum words</span><input type="number" min={100} max={10000} value={policy.minWords} onChange={(e) => setPolicy({ minWords: Number(e.target.value) })} /></label>
            <label className="field"><span>Minimum sources</span><input type="number" min={0} max={20} disabled={!policy.requireSources} aria-describedby="sources-help" value={policy.minSources} onChange={(e) => setPolicy({ minSources: Number(e.target.value) })} /></label>
            <label className="field"><span>Maximum articles per run</span><input type="number" min={0} max={20} value={policy.maxPublishedPerRun} onChange={(e) => setPolicy({ maxPublishedPerRun: Number(e.target.value) })} /></label>
          </div>
          <p className="desk-note">
            One "run" is one automation execution: if the AI sends a run_id with its calls, publishes are counted
            per run_id; otherwise publishes from this profile with less than 30 minutes between them count as one
            run. This limit covers automatic and explicit MCP publishes. The whole-website daily limit lives in
            Settings. Set 0 for no per-run limit.
          </p>
          <Check
            checked={s.aiMayEditAllDrafts}
            onChange={(e) => setS((c) => ({ ...c, aiMayEditAllDrafts: e.target.checked }))}
            label="AI may edit drafts created by other automations"
          />
          <p className="desk-note">
            Off (default): each automation profile can only edit its own drafts over MCP; the master token can edit any draft.
            On: any profile may also edit drafts created by other profiles or by you. Published articles are never editable
            unless you grant one article in its editor (“Allow AI to edit this article”), and AI can never delete a published article.
          </p>
          <p id="sources-help" className="field-help">Minimum sources is enforced only when Require sources is on.</p>
          <Check checked={policy.requireSources} onChange={(e) => setPolicy({ requireSources: e.target.checked })} label="Require sources" />
          <Check checked={policy.requireFeaturedImage} onChange={(e) => setPolicy({ requireFeaturedImage: e.target.checked })} label="Require a featured image" />
        </fieldset>
        <div className="save-row" style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn" type="submit" disabled={pending}>{pending ? "Saving…" : "Save automation"}</button>
          {error ? <span className="banner banner--bad" role="alert" style={{ margin: 0 }}>{error}</span> : message ? <span className="banner" role="status" style={{ margin: 0 }}>{message}</span> : null}
        </div>
      </form>
      <h2 className="desk-kicker" style={{ marginTop: "2rem" }}>Recent runs</h2>
      {data.runs.length === 0 ? (
        <p className="desk-note">No automation runs yet.</p>
      ) : (
        <div className="adm-scroll-x"><table className="desk-table">
          <thead><tr><th>When (UTC)</th><th>Tool</th><th>Outcome</th><th>Reason</th><th>Profile</th><th>Client</th><th>Article</th></tr></thead>
          <tbody>
            {data.runs.map((r) => (
              <tr key={r.id}>
                <td>{r.createdAt.replace("T", " ").slice(0, 16)}</td>
                <td>{r.tool}</td>
                <td>{r.outcome === "published_explicit" ? "published (explicit)" : r.outcome}{r.mode === "automatic" && r.outcome === "published" ? " (automatic)" : ""}</td>
                <td>{r.reason}</td>
                <td>{data.profiles.find((p) => p.id === r.profileId)?.name ?? r.profileId}</td>
                <td>{r.auth}</td>
                <td>{r.articleId ? <a href={`/admin/articles/${r.articleId}`}>open</a> : ""}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  );
}

const checkRow = { display: "flex", alignItems: "center", gap: "0.5rem" } as const;

function Check({ checked, onChange, label }: { checked: boolean; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; label: string }) {
  return (
    <label className="field" style={checkRow}>
      <input type="checkbox" style={{ width: "auto" }} checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}
