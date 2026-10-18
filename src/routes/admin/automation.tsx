import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import { adminAutomation, adminProfileAction, adminSaveAutomation } from "@/content/admin-api";
import { SERVER_API_PROVIDERS, type AutomationSettings } from "@/lib/automation/settings";
import { PROVIDER_KEY_SECRETS, PROVIDER_LABELS } from "@/lib/automation/provider";
import { nextExpectedRun } from "@/lib/automation/schedule";

export const Route = createFileRoute("/admin/automation")({
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

/** Named automation profiles: each AI app can connect as its own profile with its own token. */
function Profiles() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<{ profileId: string; token: string } | null>(null);
  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    return fn()
      .then(() => router.invalidate())
      .catch((caught: unknown) => setError(errorText(caught)))
      .finally(() => setBusy(false));
  };
  return (
    <section className="block-card" aria-labelledby="profiles-h" style={{ marginBottom: "1.5rem" }}>
      <h2 id="profiles-h" className="desk-kicker">Automation profiles</h2>
      <p className="desk-note">
        Several profiles can be on at the same time, each run by its own AI app on that app&apos;s schedule. Each profile is one automation (for example &ldquo;Grok daily tech&rdquo; or &ldquo;Claude weekly design&rdquo;) with its own
        on/off switch, topics, publishing rules and daily limit. Give each AI app its own profile token; the master MCP_TOKEN
        secret keeps working and acts as the Default profile.
      </p>
      {error ? <p className="banner banner--bad" role="alert">{error}</p> : null}
      {shown ? (
        <div className="banner" role="status" data-testid="new-token">
          <p style={{ margin: 0 }}>
            New token for this profile, shown <strong>once</strong>. Copy it now into your AI app (Authorization: Bearer … or the
            connector&apos;s approval page). Only a fingerprint is stored.
          </p>
          <code style={{ display: "block", wordBreak: "break-all", margin: "0.5rem 0" }}>{shown.token}</code>
          <button type="button" className="btn btn--ghost" onClick={() => void navigator.clipboard?.writeText(shown.token)}>Copy</button>{" "}
          <button type="button" className="btn btn--ghost" onClick={() => setShown(null)}>I&apos;ve saved it</button>
        </div>
      ) : null}
      <table className="desk-table">
        <thead><tr><th>Profile</th><th>Status</th><th>Token</th><th>Actions</th></tr></thead>
        <tbody>
          {data.profiles.map((p) => (
            <tr key={p.id} aria-current={p.id === data.profileId ? "true" : undefined} style={p.id === data.profileId ? { fontWeight: 650 } : undefined}>
              <td>{p.name}</td>
              <td>{!p.enabled ? "Off" : p.paused ? "Paused" : "On"}</td>
              <td>{p.isDefault ? "MCP_TOKEN secret" : p.hasToken ? `…${p.tokenHint ?? ""}` : "none"}</td>
              <td style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                <button type="button" className="btn btn--ghost" disabled={p.id === data.profileId} onClick={() => void navigate({ search: { profile: p.id } })}>
                  {p.id === data.profileId ? "Editing" : "Edit"}
                </button>
                {p.isDefault ? null : (
                  <>
                    <button type="button" className="btn btn--ghost" disabled={busy}
                      onClick={() => {
                        if (p.hasToken && !window.confirm("Replace the token? The old one (and apps signed in with it) stop working.")) return;
                        void run(async () => {
                          const r = await adminProfileAction({ data: { action: "token", profileId: p.id } });
                          if ("token" in r && r.token) setShown({ profileId: p.id, token: r.token });
                        });
                      }}>
                      {p.hasToken ? "New token" : "Create token"}
                    </button>
                    {p.hasToken ? (
                      <button type="button" className="btn btn--ghost" disabled={busy}
                        onClick={() => window.confirm("Revoke this token? Apps using it lose access immediately.") && void run(() => adminProfileAction({ data: { action: "revoke", profileId: p.id } }))}>
                        Revoke
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
                        window.confirm(`Delete “${p.name}”? Its token stops working. Its drafts and run history are kept.`) &&
                        void run(async () => {
                          await adminProfileAction({ data: { action: "delete", profileId: p.id } });
                          if (p.id === data.profileId) await navigate({ search: {} });
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
      </table>
      <form
        className="filters"
        style={{ marginTop: "0.75rem", alignItems: "end" }}
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const r = await adminProfileAction({ data: { action: "create", name } });
            setName("");
            if ("profile" in r && r.profile) await navigate({ search: { profile: r.profile.id } });
          });
        }}
      >
        <label className="field"><span>New profile name</span><input value={name} maxLength={60} placeholder="Claude weekly design" onChange={(e) => setName(e.target.value)} /></label>
        <button className="btn" type="submit" disabled={busy || name.trim().length < 2}>Add profile</button>
      </form>
    </section>
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
  const profileName = data.profiles.find((p) => p.id === data.profileId)?.name ?? "";

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
          void adminSaveAutomation({ data: { profileId: data.profileId, settings: { ...s, topicIdeas: lines(ideas), topicSources: lines(sources), extraClientHosts: lines(hosts) } } })
            .then(async () => {
              setMessage("Automation settings saved.");
              await router.invalidate();
            })
            .catch((caught: unknown) => setError(errorText(caught)))
            .finally(() => setPending(false));
        }}
      >
        <fieldset className="block-card">
          <legend>Status</legend>
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
            Claude, ChatGPT, Grok, Cursor, VS Code, Perplexity and desktop/CLI apps (loopback) are allowed already. Add the host of any
            other MCP client&apos;s OAuth callback here (one per line, e.g. connectors.example.com).
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
              <p className="desk-note" data-testid="next-topic">Next topic in order: {data.selection.suggestedTopic ? `#${(data.selection.suggestedIndex ?? 0) + 1} “${data.selection.suggestedTopic}”` : "your list is empty"}. The position only moves when an AI draft actually uses a topic.</p>
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
            <p className="banner banner--bad" role="alert" data-testid="no-topics-warning">
              Automatic publishing is on, but no topic is ticked below, so nothing can be published automatically. Tick the topics
              this automation may publish into.
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
            <label className="field"><span>Minimum sources</span><input type="number" min={0} max={20} value={policy.minSources} onChange={(e) => setPolicy({ minSources: Number(e.target.value) })} /></label>
            <label className="field"><span>Max auto-published per day</span><input type="number" min={0} max={20} value={policy.maxPublishedPerDay} onChange={(e) => setPolicy({ maxPublishedPerDay: Number(e.target.value) })} /></label>
          </div>
          <Check checked={policy.requireSources} onChange={(e) => setPolicy({ requireSources: e.target.checked })} label="Require sources" />
          <Check checked={policy.requireFeaturedImage} onChange={(e) => setPolicy({ requireFeaturedImage: e.target.checked })} label="Require a featured image" />
        </fieldset>
        <button className="btn" type="submit" disabled={pending}>{pending ? "Saving…" : "Save automation"}</button>
      </form>
      <h2 className="desk-kicker" style={{ marginTop: "2rem" }}>Recent runs</h2>
      {data.runs.length === 0 ? (
        <p className="desk-note">No automation runs yet.</p>
      ) : (
        <table className="desk-table">
          <thead><tr><th>When (UTC)</th><th>Tool</th><th>Outcome</th><th>Reason</th><th>Profile</th><th>Client</th><th>Article</th></tr></thead>
          <tbody>
            {data.runs.map((r) => (
              <tr key={r.id}>
                <td>{r.createdAt.replace("T", " ").slice(0, 16)}</td>
                <td>{r.tool}</td>
                <td>{r.outcome}</td>
                <td>{r.reason}</td>
                <td>{data.profiles.find((p) => p.id === r.profileId)?.name ?? r.profileId}</td>
                <td>{r.auth}</td>
                <td>{r.articleId ? <a href={`/admin/articles/${r.articleId}`}>open</a> : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
