import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import { adminAutomation, adminSaveAutomation } from "@/content/admin-api";
import type { AutomationSettings } from "@/lib/automation/settings";

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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const policy = s.policy;
  const setPolicy = (next: Partial<AutomationSettings["policy"]>) => setS((c) => ({ ...c, policy: { ...c.policy, ...next } }));

  return (
    <>
      <p className="desk-kicker">Grok</p>
      <h1 className="desk-title">Automation</h1>
      <p className="desk-note">
        Grok drafts pieces through this site&apos;s MCP endpoint (<code>/mcp</code>). The schedule lives in Grok Automations,
        not here. MCP token: {data.mcpTokenConfigured ? "configured" : "not set (endpoint disabled)"}. Active provider:{" "}
        {data.provider.active}. {data.provider.note}
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
          void adminSaveAutomation({ data: { ...s, topicIdeas: lines(ideas), topicSources: lines(sources) } })
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
            <select value={s.provider} onChange={(e) => setS({ ...s, provider: e.target.value as AutomationSettings["provider"] })}>
              <option value="grok-mcp">grok-mcp (Grok writes through MCP)</option>
              <option value="xai-api">xai-api (future; inactive without XAI_API_KEY)</option>
            </select>
          </label>
          <label className="field">
            <span>Featured image transfer from Grok</span>
            <select value={s.imageTransfer} onChange={(e) => setS({ ...s, imageTransfer: e.target.value as AutomationSettings["imageTransfer"] })}>
              <option value="untested">Untested (verify once in Grok)</option>
              <option value="verified">Verified working</option>
              <option value="unsupported">Unsupported (upload in Media)</option>
            </select>
          </label>
        </fieldset>
        <fieldset className="block-card">
          <legend>Topic sources</legend>
          <label className="field"><span>Topic ideas (one per line)</span><textarea value={ideas} onChange={(e) => setIdeas(e.target.value)} /></label>
          <label className="field"><span>Source sites to research (https URLs, one per line)</span><textarea value={sources} onChange={(e) => setSources(e.target.value)} /></label>
        </fieldset>
        <fieldset className="block-card">
          <legend>Publishing policy</legend>
          <p className="desk-note">Off by default: every piece stays a draft. Turn on only with explicit rules.</p>
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
          <thead><tr><th>When (UTC)</th><th>Tool</th><th>Outcome</th><th>Reason</th><th>Piece</th></tr></thead>
          <tbody>
            {data.runs.map((r) => (
              <tr key={r.id}>
                <td>{r.createdAt.replace("T", " ").slice(0, 16)}</td>
                <td>{r.tool}</td>
                <td>{r.outcome}</td>
                <td>{r.reason}</td>
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
