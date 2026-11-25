import "@/styles-master-mcp.css";
import { useEffect, useMemo, useState } from "react";
import {
  adminCreateMasterCredential,
  adminDeactivateMasterCredential,
  adminDeleteMasterCredential,
  adminMasterMcp,
  adminReactivateMasterCredential,
  adminRotateMasterCredential,
  adminUpdateMasterPermissions,
} from "@/content/master-mcp-api";
import type { CreatedMasterProfile, MasterAuthMethod, MasterProfileView } from "@/content/master-mcp-profiles.server";
import type { MasterPermissionKey, MasterPermissionsMap } from "@/lib/mcp/master/permissions";
import {
  DEFAULT_MASTER_PERMISSIONS,
  MASTER_LOCKED_PERMISSIONS,
  MASTER_TOGGLEABLE_PERMISSIONS,
} from "@/lib/mcp/master/permissions";

type Payload = {
  profiles: MasterProfileView[];
  permissionToggles?: MasterPermissionsMap;
  toggleablePermissions?: readonly { key: MasterPermissionKey; label: string }[];
  lockedPermissions?: readonly { key: string; label: string }[];
};

function endpoint(): string {
  if (typeof window === "undefined") return "/mcp";
  return `${window.location.origin}/mcp`;
}

function statusLabel(status: MasterProfileView["status"]): string {
  if (status === "active") return "Active";
  if (status === "deactivated") return "Paused";
  return "Revoked";
}

export function MasterMcpPanel({ initial }: { initial?: Payload | null }) {
  const [data, setData] = useState<Payload | null>(initial ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [authMethod, setAuthMethod] = useState<MasterAuthMethod>("api_key");
  const [redirects, setRedirects] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<CreatedMasterProfile | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
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
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const copyText = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((curr) => (curr === key ? null : curr));
    }, 1500);
  };

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setNameError("Enter a profile name first.");
      return;
    }
    setNameError(null);
    void run("create", async () => {
      const out = await adminCreateMasterCredential({
        data: {
          name: trimmed,
          authMethod,
          redirects: authMethod === "oauth" ? redirects.trim() : undefined,
        },
      });
      setCreatedSecret(out);
      setNewName("");
      setRedirects("");
    });
  };

  const handleTogglePermission = (key: MasterPermissionKey, nextVal: boolean) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            permissionToggles: {
              ...(prev.permissionToggles ?? DEFAULT_MASTER_PERMISSIONS),
              [key]: nextVal,
            },
          }
        : prev,
    );
    setBusy(`perm-${key}`);
    setError(null);
    void adminUpdateMasterPermissions({ data: { key, enabled: nextVal } })
      .then((res) => {
        setData((prev) => (prev ? { ...prev, permissionToggles: res.permissionToggles } : prev));
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Could not update permission.");
        void reload();
      })
      .finally(() => {
        setBusy(null);
      });
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

  const profiles = data.profiles ?? [];
  const activeCount = profiles.filter((p) => p.status === "active").length;
  const toggles = data.permissionToggles ?? DEFAULT_MASTER_PERMISSIONS;
  const toggleable = data.toggleablePermissions ?? MASTER_TOGGLEABLE_PERMISSIONS;
  const locked = data.lockedPermissions ?? MASTER_LOCKED_PERMISSIONS;

  return (
    <div className="mm-panel">
      {error ? <p className="banner banner--bad" role="alert">{error}</p> : null}

      <fieldset className="block-card mm-card">
        <legend>Master MCP Profiles ({activeCount} active)</legend>

        <div className="mm-endpoint">
          <span className="mm-endpoint__label">Endpoint</span>
          <code className="mm-endpoint__url">{mcpUrl}</code>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => copyText("url", mcpUrl)}>
            {copiedKey === "url" ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="mm-creator" role="group" aria-label="Create Master MCP profile">
          <div className="mm-creator__row">
            <label className="field mm-creator__name">
              <span>Profile name *</span>
              <input
                type="text"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (nameError && e.target.value.trim()) setNameError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
                maxLength={80}
                placeholder="e.g. Claude, Grok, Ops Agent"
                aria-invalid={Boolean(nameError)}
              />
            </label>

            <div className="mm-creator__method">
              <span className="mm-field-label">Authentication</span>
              <div className="mm-seg" role="radiogroup" aria-label="Authentication method">
                <button
                  type="button"
                  role="radio"
                  aria-checked={authMethod === "api_key"}
                  className={`mm-seg__btn${authMethod === "api_key" ? " is-active" : ""}`}
                  onClick={() => setAuthMethod("api_key")}
                >
                  API Key
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={authMethod === "oauth"}
                  className={`mm-seg__btn${authMethod === "oauth" ? " is-active" : ""}`}
                  onClick={() => setAuthMethod("oauth")}
                >
                  Client ID &amp; Secret
                </button>
              </div>
            </div>

            <button
              type="button"
              className="btn btn--primary mm-creator__save"
              disabled={Boolean(busy) || newName.trim().length === 0}
              onClick={handleCreate}
            >
              {busy === "create" ? "Saving…" : "Save"}
            </button>
          </div>

          {authMethod === "oauth" ? (
            <label className="field mm-creator__redir">
              <span>Redirect URL (optional — leave blank for Claude, ChatGPT, Grok, Gemini)</span>
              <input
                type="text"
                value={redirects}
                onChange={(e) => setRedirects(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
                placeholder="https://claude.ai/api/mcp/auth_callback"
              />
            </label>
          ) : null}

          {nameError ? <p className="mm-inline-error" role="alert">{nameError}</p> : null}
        </div>

        {createdSecret ? (
          <div className="mm-secret" role="status">
            <div className="mm-secret__head">
              <strong>{createdSecret.name}</strong>
              <span className="mm-pill">{createdSecret.authMethod === "oauth" ? "Client ID & Secret" : "API Key"}</span>
            </div>
            <p className="mm-secret__warn">Copy these credentials now. They disappear once you tap Okay.</p>

            {createdSecret.authMethod === "api_key" ? (
              <div className="mm-secret__item">
                <span className="mm-secret__label">API Key</span>
                <code className="mm-secret__val">{createdSecret.token}</code>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => copyText("apiKey", createdSecret.token)}>
                  {copiedKey === "apiKey" ? "Copied" : "Copy"}
                </button>
              </div>
            ) : (
              <>
                <div className="mm-secret__item">
                  <span className="mm-secret__label">Client ID</span>
                  <code className="mm-secret__val">{createdSecret.clientId}</code>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => copyText("cid", createdSecret.clientId)}>
                    {copiedKey === "cid" ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="mm-secret__item">
                  <span className="mm-secret__label">Client Secret</span>
                  <code className="mm-secret__val">{createdSecret.clientSecret}</code>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => copyText("csec", createdSecret.clientSecret)}>
                    {copiedKey === "csec" ? "Copied" : "Copy"}
                  </button>
                </div>
              </>
            )}

            <div className="mm-secret__foot">
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setCreatedSecret(null)}>
                Okay
              </button>
            </div>
          </div>
        ) : null}

        <div className="mm-list">
          {profiles.length === 0 ? (
            <p className="desk-note" style={{ margin: "0.25rem 0 0" }}>No profiles yet. Enter a name and save one above.</p>
          ) : (
            profiles.map((p) => (
              <div key={p.id} className="mm-profile">
                <div className="mm-profile__info">
                  <strong className="mm-profile__name">{p.name}</strong>
                  <span className="mm-pill">{p.authMethod === "oauth" ? "Client ID & Secret" : "API Key"}</span>
                  <span className={`badge${p.status === "active" ? " badge--master" : p.status === "deactivated" ? " badge--scheduled" : ""}`}>
                    {statusLabel(p.status)}
                  </span>
                  <code className="mm-profile__hint">
                    {p.authMethod === "oauth" ? p.clientId : p.tokenPrefix}
                  </code>
                </div>
                <div className="mm-profile__actions">
                  {p.status !== "revoked" ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void run(`toggle-${p.id}`, async () => {
                            if (p.status === "active") await adminDeactivateMasterCredential({ data: { id: p.id } });
                            else await adminReactivateMasterCredential({ data: { id: p.id } });
                          })
                        }
                      >
                        {p.status === "active" ? "Pause" : "Resume"}
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void run(`rotate-${p.id}`, async () => {
                            if (!confirm(`Rotate credentials for "${p.name}"? The old secret will stop working immediately.`)) return;
                            const out = await adminRotateMasterCredential({ data: { id: p.id } });
                            setCreatedSecret(out);
                          })
                        }
                      >
                        Rotate
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn--sm btn--danger"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run(`delete-${p.id}`, async () => {
                        if (!confirm(`Delete profile "${p.name}"?`)) return;
                        await adminDeleteMasterCredential({ data: { id: p.id } });
                      })
                    }
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </fieldset>

      <fieldset className="block-card mm-card">
        <legend>Permissions</legend>
        <div className="mm-perms" role="list">
          {toggleable.map((item) => {
            const on = toggles[item.key] !== false;
            return (
              <div key={item.key} className="mm-perm" role="listitem">
                <span className="mm-perm__label">{item.label}</span>
                <label className="mm-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={on}
                    disabled={busy === `perm-${item.key}`}
                    aria-label={item.label}
                    onChange={(e) => handleTogglePermission(item.key, e.target.checked)}
                  />
                  <span className="mm-switch__track" aria-hidden="true" />
                </label>
              </div>
            );
          })}
          {locked.map((item) => (
            <div key={item.key} className="mm-perm mm-perm--locked" role="listitem">
              <span className="mm-perm__label">{item.label}</span>
              <span className="mm-perm__lock">Owner only</span>
            </div>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
