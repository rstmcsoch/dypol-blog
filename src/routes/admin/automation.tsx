import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import { adminAutomation, adminSaveAutomation } from "@/content/admin-api";
import { SERVER_API_PROVIDERS, type AutomationSettings } from "@/lib/automation/settings";
import { PROVIDER_KEY_SECRETS, PROVIDER_LABELS } from "@/lib/automation/provider";

export const Route = createFileRoute("/admin/automation")({
  loader: () => adminAutomation(),
  component: AutomationDesk,
});

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

  return (
    <>
      <p className="desk-kicker">AI connector</p>
      <h1 className="desk-title">Automation</h1>
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
          void adminSaveAutomation({ data: { ...s, topicIdeas: lines(ideas), topicSources: lines(sources), extraClientHosts: lines(hosts) } })
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
          <label className="field"><span>Topic ideas (one per line, up to 200)</span><textarea value={ideas} onChange={(e) => setIdeas(e.target.value)} /></label>
          <label className="field"><span>Source sites to research (https URLs, one per line)</span><textarea value={sources} onChange={(e) => setSources(e.target.value)} /></label>
        </fieldset>
        <fieldset className="block-card">
          <legend>Other AI clients</legend>
          <p className="desk-note">
            Claude, ChatGPT, Grok, Cursor, VS Code, Perplexity and desktop/CLI apps (loopback) are allowed already. Add the host of any
            other MCP client&apos;s OAuth callback here (one per line, e.g. connectors.example.com).
          </p>
          <label className="field"><span>Extra client hosts</span><textarea value={hosts} onChange={(e) => setHosts(e.target.value)} /></label>
        </fieldset>
        <fieldset className="block-card">
          <legend>Publishing policy</legend>
          <p className="desk-note">Off by default: every AI article stays a draft. Turn on only with explicit rules.</p>
          <Check checked={policy.autoPublish} onChange={(e) => setPolicy({ autoPublish: e.target.checked })} label="Allow automatic publishing" />
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
          <thead><tr><th>When (UTC)</th><th>Tool</th><th>Outcome</th><th>Reason</th><th>Client</th><th>Article</th></tr></thead>
          <tbody>
            {data.runs.map((r) => (
              <tr key={r.id}>
                <td>{r.createdAt.replace("T", " ").slice(0, 16)}</td>
                <td>{r.tool}</td>
                <td>{r.outcome}</td>
                <td>{r.reason}</td>
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
