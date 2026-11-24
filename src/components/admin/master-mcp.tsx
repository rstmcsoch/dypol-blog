import { useEffect, useMemo, useState } from "react";
import {
  adminCreateMasterCredential,
  adminDeactivateMasterCredential,
  adminDeleteMasterCredential,
  adminIssueMasterOauth,
  adminMasterMcp,
  adminReactivateMasterCredential,
  adminRenameMasterCredential,
  adminRevokeMasterCredential,
  adminRevokeMasterOauth,
  adminRotateMasterCredential,
} from "@/content/master-mcp-api";
import type { MasterConnectionView } from "@/content/master-mcp.server";
import type { MasterProfileView } from "@/content/master-mcp-profiles.server";
import type { PermissionSummaryItem } from "@/lib/mcp/master/permissions";

type AuditRow = { at: string; toolName: string; action: string; resourceId: string | null; success: boolean; error: string | null; clientName: string | null };
type Payload = {
  connection: MasterConnectionView;
  profiles?: MasterProfileView[];
  usage: { calls24h: number; failures24h: number; calls7d: number };
  audit: AuditRow[];
  permissions: readonly PermissionSummaryItem[];
};

function endpoint(): string {
  if (typeof window === "undefined") return "/mcp";
  return `${window.location.origin}/mcp`;
}

function when(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) + " IST";
}

function statusLabel(status: MasterConnectionView["status"]): string {
  if (status === "active") return "Active";
  if (status === "deactivated") return "Deactivated";
  if (status === "revoked") return "Revoked";
  return "Not created";
}

export function MasterMcpPanel({ initial }: { initial?: Payload | null }) {
  const [data, setData] = useState<Payload | null>(initial ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [shownToken, setShownToken] = useState<{ token: string; name: string } | null>(null);
  const [shownOauth, setShownOauth] = useState<{ clientId: string; clientSecret: string } | null>(null);
  const [redirects, setRedirects] = useState("");
  const mcpUrl = useMemo(endpoint, [data]);

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    void adminMasterMcp()
      .then((next) => { if (!cancelled) setData(next); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load Master MCP."); });
    return () => { cancelled = true; };
  }, [data]);

  const reload = async () => {
    const next = await adminMasterMcp();
    setData(next);
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return (
      <p className="desk-note">
        <button type="button" className="btn btn--ghost" onClick={() => void run("load", async () => undefined)}>
          Load Master MCP
        </button>
      </p>
    );
  }

  const c = data.connection;
  const profiles: MasterProfileView[] = data.profiles ?? (c.id
    ? [{
        id: c.id,
        name: c.name,
        status: c.status === "absent" ? "revoked" : c.status,
        tokenPrefix: c.tokenPrefix,
        createdAt: c.createdAt ?? "",
        lastConnectedAt: c.lastConnectedAt,
        lastActivityAt: c.lastActivityAt,
        lastClientName: c.lastClientName,
        revokedAt: null,
        deactivatedAt: null,
      }]
    : []);
  const activeCount = profiles.filter((p) => p.status === "active").length;

  return (
    <div className="stack" style={{ gap: "1.1rem" }}>
      {error ? <p className="banner banner--bad" role="alert">{error}</p> : null}

      <fieldset className="block-card">
        <legend>Master MCP profiles ({activeCount} active / {profiles.length} total)</legend>
        <p className="desk-note">
          Create and manage multiple owner-provisioned Master MCP profiles — each agent or device gets its own
          bearer credential, name, status toggle, and audit trail on <code>{mcpUrl}</code>.
        </p>
        <dl className="master-mcp-dl">
          <div><dt>MCP endpoint</dt><dd><code>{mcpUrl}</code> <CopyButton text={mcpUrl} /></dd></div>
          <div><dt>Methods</dt><dd>Per-profile Bearer credential (<code>dypm_…</code>), or OAuth 2.1 + PKCE client below</dd></div>
        </dl>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run("create", async () => {
              const out = await adminCreateMasterCredential({ data: { name: newName.trim() || `Master MCP ${profiles.length + 1}` } });
              setShownToken({ token: out.token, name: out.name });
              setNewName("");
            });
          }}
          style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end", marginTop: "0.9rem" }}
        >
          <label className="field" style={{ flex: "1 1 220px", margin: 0 }}>
            <span>New Master MCP profile name</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={80}
              placeholder="e.g. Wabi Agent, Claude Desktop, Ops Bot"
            />
          </label>
          <button type="submit" className="btn btn--primary" disabled={Boolean(busy)}>
            {busy === "create" ? "Creating…" : "+ Add Master profile"}
          </button>
        </form>

        {shownToken ? (
          <div className="banner" role="status" style={{ marginTop: "0.9rem" }}>
            <p style={{ margin: 0 }}>New credential for <strong>{shownToken.name}</strong>, shown <strong>once</strong>. Copy it now — only a hash is stored.</p>
            <p><code style={{ wordBreak: "break-all" }}>{shownToken.token}</code></p>
            <button type="button" className="btn btn--ghost" onClick={() => void navigator.clipboard?.writeText(shownToken.token)}>Copy</button>{" "}
            <button type="button" className="btn btn--ghost" onClick={() => setShownToken(null)}>I have copied it</button>
          </div>
        ) : null}

        {profiles.length === 0 ? (
          <p className="desk-note" style={{ marginTop: "0.9rem" }}>No Master MCP profiles yet. Add one above to generate a bearer credential.</p>
        ) : (
          <div className="stack" style={{ gap: "0.75rem", marginTop: "1rem" }}>
            {profiles.map((p) => {
              const isEditing = editingId === p.id;
              return (
                <div
                  key={p.id}
                  style={{
                    padding: "0.9rem 1rem",
                    border: "1px solid var(--a-line, #ddd)",
                    borderRadius: "10px",
                    display: "grid",
                    gap: "0.55rem",
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
                      {isEditing ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void run(`rename-${p.id}`, async () => {
                              await adminRenameMasterCredential({ data: { id: p.id, name: editingName } });
                              setEditingId(null);
                            });
                          }}
                          style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}
                        >
                          <input value={editingName} onChange={(e) => setEditingName(e.target.value)} maxLength={80} required />
                          <button type="submit" className="btn btn--sm btn--primary" disabled={Boolean(busy)}>Save</button>
                          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setEditingId(null)}>Cancel</button>
                        </form>
                      ) : (
                        <>
                          <strong>{p.name}</strong>
                          <span className={`badge${p.status === "active" ? " badge--master" : p.status === "deactivated" ? " badge--scheduled" : ""}`}>
                            {statusLabel(p.status)}
                          </span>
                          {p.tokenPrefix ? <code style={{ fontSize: "0.82rem" }}>{p.tokenPrefix}</code> : null}
                        </>
                      )}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                      {!isEditing ? (
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          disabled={Boolean(busy)}
                          onClick={() => { setEditingId(p.id); setEditingName(p.name); }}
                        >
                          Rename
                        </button>
                      ) : null}
                      {p.status !== "revoked" ? (
                        <>
                          <button
                            type="button"
                            className="btn btn--sm"
                            disabled={Boolean(busy)}
                            onClick={() => void run(`rotate-${p.id}`, async () => {
                              if (!confirm(`Rotate credential for "${p.name}"? Its current secret will stop working immediately.`)) return;
                              const out = await adminRotateMasterCredential({ data: { id: p.id } });
                              setShownToken({ token: out.token, name: out.name });
                            })}
                          >
                            Rotate
                          </button>
                          {p.status === "active" ? (
                            <button
                              type="button"
                              className="btn btn--sm btn--ghost"
                              disabled={Boolean(busy)}
                              onClick={() => void run(`deact-${p.id}`, async () => {
                                await adminDeactivateMasterCredential({ data: { id: p.id } });
                              })}
                            >
                              Deactivate
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn--sm btn--ghost"
                              disabled={Boolean(busy)}
                              onClick={() => void run(`react-${p.id}`, async () => {
                                await adminReactivateMasterCredential({ data: { id: p.id } });
                              })}
                            >
                              Reactivate
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost"
                            disabled={Boolean(busy)}
                            onClick={() => void run(`revoke-${p.id}`, async () => {
                              if (!confirm(`Revoke "${p.name}" permanently?`)) return;
                              await adminRevokeMasterCredential({ data: { id: p.id } });
                            })}
                          >
                            Revoke
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn--sm btn--danger"
                        disabled={Boolean(busy)}
                        onClick={() => void run(`delete-${p.id}`, async () => {
                          if (!confirm(`Delete profile "${p.name}"? Any agent using its token will immediately lose access.`)) return;
                          await adminDeleteMasterCredential({ data: { id: p.id } });
                        })}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: "0.84rem", display: "flex", flexWrap: "wrap", gap: "0.5rem 1.25rem" }}>
                    <span>Created: {when(p.createdAt)}</span>
                    <span>Last connected: {when(p.lastConnectedAt)}</span>
                    <span>Last activity: {when(p.lastActivityAt)}</span>
                    {p.lastClientName ? <span>Client: {p.lastClientName}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </fieldset>

      <fieldset className="block-card">
        <legend>Connection instructions</legend>
        <ol className="desk-note" style={{ paddingLeft: "1.2rem" }}>
          <li>Add a named Master MCP profile above and copy its bearer secret immediately.</li>
          <li>In your external agent, add an MCP server with URL <code>{mcpUrl}</code> and <code>Authorization: Bearer &lt;secret&gt;</code>.</li>
          <li>Or create an OAuth client below, paste the redirect URL your agent shows, and copy the client ID and secret into the agent.</li>
          <li>Rename, rotate, deactivate, revoke, or delete any profile individually at any time.</li>
        </ol>
      </fieldset>

      <fieldset className="block-card">
        <legend>OAuth 2.1 + PKCE (optional)</legend>
        <p className="desk-note">For agents that will not accept a bearer key. The client is bound to the Master identity, not to a publishing profile.</p>
        {c.oauth && c.oauth.status === "active" ? (
          <p>Active client <code>{c.oauth.id}</code> ({c.oauth.name}), secret fingerprint …{c.oauth.secretHint}. Redirects: {c.oauth.redirectUris.join(", ") || "—"}.</p>
        ) : (
          <p className="desk-note">No active Master OAuth client.</p>
        )}
        {shownOauth ? (
          <div className="banner" role="status">
            <p style={{ margin: 0 }}>Client secret shown <strong>once</strong>. Only a hash is stored.</p>
            <p>Client ID: <code style={{ wordBreak: "break-all" }}>{shownOauth.clientId}</code> <CopyButton text={shownOauth.clientId} /></p>
            <p>Secret: <code style={{ wordBreak: "break-all" }}>{shownOauth.clientSecret}</code> <CopyButton text={shownOauth.clientSecret} /></p>
            <button type="button" className="btn btn--ghost" onClick={() => setShownOauth(null)}>I have copied them</button>
          </div>
        ) : null}
        <label className="field">
          <span>Redirect URLs (one per line, from the agent — do not invent them)</span>
          <textarea value={redirects} onChange={(e) => setRedirects(e.target.value)} rows={3} placeholder="https://oauth-redirect.googleusercontent.com/r/…" />
        </label>
        <div className="row" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void run("oauth", async () => {
            const out = await adminIssueMasterOauth({ data: { name: "Master MCP OAuth", redirects } });
            setShownOauth({ clientId: out.clientId, clientSecret: out.clientSecret });
          })}>{busy === "oauth" ? "Creating…" : c.oauth && c.oauth.status === "active" ? "Replace OAuth client" : "Create OAuth client"}</button>
          {c.oauth && c.oauth.status === "active" ? (
            <button type="button" className="btn btn--ghost" disabled={Boolean(busy)} onClick={() => void run("oauth-revoke", async () => {
              if (!confirm("Revoke the Master MCP OAuth client?")) return;
              await adminRevokeMasterOauth();
              setShownOauth(null);
            })}>Revoke OAuth client</button>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="block-card">
        <legend>Permissions</legend>
        <p className="desk-note">This is a summary of the permissions the server actually enforces, not decorative labels.</p>
        <div className="adm-scroll-x">
          <table className="table">
            <thead><tr><th>Area</th><th>Access</th><th>Detail</th></tr></thead>
            <tbody>
              {data.permissions.map((row) => (
                <tr key={row.area}>
                  <td>{row.area}</td>
                  <td>{row.level}</td>
                  <td>{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>

      <fieldset className="block-card">
        <legend>Usage and recent operations</legend>
        <p className="desk-note">{data.usage.calls24h} calls in the last 24 hours ({data.usage.failures24h} failed). {data.usage.calls7d} in the last 7 days.</p>
        {data.audit.length === 0 ? (
          <p className="desk-note">No Master MCP operations recorded yet.</p>
        ) : (
          <div className="adm-scroll-x">
            <table className="table">
              <thead><tr><th>When (IST)</th><th>Tool</th><th>Result</th><th>Resource</th><th>Client</th></tr></thead>
              <tbody>
                {data.audit.map((row, i) => (
                  <tr key={`${row.at}-${i}`}>
                    <td>{when(row.at)}</td>
                    <td><code>{row.toolName}</code></td>
                    <td>{row.success ? "OK" : row.error ?? "Failed"}</td>
                    <td>{row.resourceId ?? "—"}</td>
                    <td>{row.clientName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </fieldset>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  return (
    <button type="button" className="btn btn--ghost" onClick={() => void navigator.clipboard?.writeText(text)}>
      Copy
    </button>
  );
}
