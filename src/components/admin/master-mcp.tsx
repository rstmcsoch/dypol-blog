import { useEffect, useMemo, useState } from "react";
import {
  adminCreateMasterCredential,
  adminDeactivateMasterCredential,
  adminIssueMasterOauth,
  adminMasterMcp,
  adminReactivateMasterCredential,
  adminRevokeMasterCredential,
  adminRevokeMasterOauth,
  adminRotateMasterCredential,
} from "@/content/master-mcp-api";
import type { MasterConnectionView } from "@/content/master-mcp.server";
import type { PermissionSummaryItem } from "@/lib/mcp/master/permissions";

type AuditRow = { at: string; toolName: string; action: string; resourceId: string | null; success: boolean; error: string | null; clientName: string | null };
type Payload = {
  connection: MasterConnectionView;
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
  const [shownToken, setShownToken] = useState<string | null>(null);
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
  return (
    <div className="stack" style={{ gap: "1.1rem" }}>
      {error ? <p className="banner banner--bad" role="alert">{error}</p> : null}

      <fieldset className="block-card">
        <legend>Connection</legend>
        <p className="desk-note">
          A dedicated owner-provisioned identity for an operations agent. It is not a publishing profile and does not
          appear in Admin → AI Automation. The existing <code>MCP_TOKEN</code> and profile keys keep their current
          meaning and do not receive these privileges.
        </p>
        <p>
          <span className={`badge${c.status === "active" ? " badge--master" : c.status === "deactivated" ? " badge--scheduled" : ""}`}>
            {statusLabel(c.status)}
          </span>
        </p>
        <dl className="master-mcp-dl">
          <div><dt>MCP endpoint</dt><dd><code>{mcpUrl}</code> <CopyButton text={mcpUrl} /></dd></div>
          <div><dt>Methods</dt><dd>Bearer credential, or an owner-provisioned OAuth 2.1 + PKCE client</dd></div>
          <div><dt>Credential fingerprint</dt><dd>{c.tokenPrefix ?? "—"}</dd></div>
          <div><dt>Last successful connection</dt><dd>{when(c.lastConnectedAt)}</dd></div>
          <div><dt>Last activity</dt><dd>{when(c.lastActivityAt)}</dd></div>
          <div><dt>Last connected client</dt><dd>{c.lastClientName ?? "—"}</dd></div>
        </dl>
        {shownToken ? (
          <div className="banner" role="status">
            <p style={{ margin: 0 }}>New Master MCP credential, shown <strong>once</strong>. Copy it now. Only a hash is stored; it cannot be shown again.</p>
            <p><code style={{ wordBreak: "break-all" }}>{shownToken}</code></p>
            <button type="button" className="btn btn--ghost" onClick={() => void navigator.clipboard?.writeText(shownToken)}>Copy</button>{" "}
            <button type="button" className="btn btn--ghost" onClick={() => setShownToken(null)}>I have copied it</button>
          </div>
        ) : null}
        <div className="row" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.8rem" }}>
          {c.status === "absent" || c.status === "revoked" ? (
            <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void run("create", async () => {
              const out = await adminCreateMasterCredential({ data: { name: "Master MCP" } });
              setShownToken(out.token);
            })}>{busy === "create" ? "Creating…" : "Create credential"}</button>
          ) : (
            <>
              <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void run("rotate", async () => {
                if (!confirm("Rotate the Master MCP credential? The current secret will stop working immediately.")) return;
                const out = await adminRotateMasterCredential();
                setShownToken(out.token);
              })}>{busy === "rotate" ? "Rotating…" : "Rotate credential"}</button>
              {c.status === "active" ? (
                <button type="button" className="btn btn--ghost" disabled={Boolean(busy)} onClick={() => void run("deactivate", async () => {
                  await adminDeactivateMasterCredential();
                })}>Deactivate</button>
              ) : (
                <button type="button" className="btn btn--ghost" disabled={Boolean(busy)} onClick={() => void run("reactivate", async () => {
                  await adminReactivateMasterCredential();
                })}>Reactivate</button>
              )}
              <button type="button" className="btn btn--ghost" disabled={Boolean(busy)} onClick={() => void run("revoke", async () => {
                if (!confirm("Revoke the Master MCP credential permanently? You can create a new one afterwards.")) return;
                await adminRevokeMasterCredential();
                setShownToken(null);
              })}>Revoke</button>
            </>
          )}
        </div>
      </fieldset>

      <fieldset className="block-card">
        <legend>Connection instructions</legend>
        <ol className="desk-note" style={{ paddingLeft: "1.2rem" }}>
          <li>Create or rotate the bearer credential above and copy the secret immediately.</li>
          <li>In your external agent, add an MCP server with URL <code>{mcpUrl}</code> and <code>Authorization: Bearer &lt;secret&gt;</code>.</li>
          <li>Or create an OAuth client below, paste the redirect URL your agent shows, and copy the client ID and secret into the agent. Approve the connection while signed in to this desk, or with the site MCP token — never with a publishing profile key.</li>
          <li>Deactivate or revoke access here at any time. The change takes effect on the next request.</li>
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
