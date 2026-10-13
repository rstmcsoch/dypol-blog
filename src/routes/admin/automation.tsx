import { useState } from "react";
import { createFileRoute, Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import { AdminPageError } from "@/components/admin/page-error";
import { AutomationSchemaNotice } from "@/components/admin/automation-schema-notice";
import {
  adminAutomation,
  adminDeleteAutomation,
  adminDuplicateAutomation,
  adminRunAutomation,
  adminSaveAutomation,
  adminTestAutomation,
} from "@/content/admin-api";
import {
  CONTENT_STYLES,
  CONTENT_STYLE_LABELS,
  CREDENTIAL_REFS,
  DEFAULT_AUTOMATION_INPUT,
  IMAGE_MODES,
  PUBLISH_MODES,
  TOPIC_SOURCES,
  TOPIC_SOURCE_LABELS,
  cronPresets,
  defaultModelFor,
  providerNeedsBaseUrl,
  type AutomationInput,
  type AutomationRecord,
} from "@/lib/automation/automation";
import { PROVIDER_LABELS } from "@/lib/automation/provider";
import { AUTOMATION_MODES, SERVER_API_PROVIDERS } from "@/lib/automation/settings";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/admin/automation")({
  loader: () => adminAutomation(),
  component: AutomationAdmin,
  errorComponent: AdminPageError,
});

type RunResult = Awaited<ReturnType<typeof adminRunAutomation>>["outcome"];
type TestResult = Awaited<ReturnType<typeof adminTestAutomation>>;

function AutomationAdmin() {
  const data = Route.useLoaderData();
  const pathname = useRouterState({ select: (state) => state.location.pathname.replace(/\/$/, "") });
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ id: string; result: RunResult; dryRun: boolean } | null>(null);
  const [test, setTest] = useState<{ id: string; result: TestResult } | null>(null);

  if (pathname === "/admin/automation/history") return <Outlet />;
  if (!data.ready) return <AutomationSchemaNotice schema={data.schema} environment={data.environment} />;
  const credentials = data.credentials;

  const run = async (key: string, work: () => Promise<unknown>, success?: string) => {
    setPending(key);
    setError(null);
    setMessage(null);
    try {
      await work();
      if (success) setMessage(success);
      await router.invalidate();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(null);
    }
  };

  const onTest = async (id: string) => {
    setPending(`test:${id}`);
    setError(null);
    setMessage(null);
    try {
      setTest({ id, result: await adminTestAutomation({ data: { id } }) });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(null);
    }
  };

  const onRun = async (id: string, dryRun: boolean) => {
    setPending(`run:${id}:${dryRun}`);
    setError(null);
    setMessage(null);
    try {
      const result = await adminRunAutomation({ data: { id, dryRun } });
      setOutcome({ id, result: result.outcome, dryRun });
      await router.invalidate();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <p className="desk-kicker">Automation</p>
      <h1 className="desk-title">Automations</h1>
      <p className="desk-note">
        Each automation has its own provider, credential, topics, schedule and publishing rules. They never share settings, and they all publish to this
        site. {data.mcpTokenConfigured ? "The MCP endpoint is enabled for client-driven drafts." : "The MCP endpoint is disabled (no MCP_TOKEN secret)."}
      </p>

      {error ? (
        <p className="banner banner--bad" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="banner banner--ok" role="status">
          {message}
        </p>
      ) : null}

      <div className="builder-bar">
        <button type="button" className="btn" onClick={() => { setCreating(true); setEditing(null); }}>
          New automation
        </button>
        <Link to="/admin/automation/history" className="btn btn--ghost">
          History & diagnostics
        </Link>
      </div>

      {creating ? (
        <AutomationForm
          key="new"
          initial={{ ...DEFAULT_AUTOMATION_INPUT, name: `Automation ${data.automations.length + 1}` }}
          credentials={credentials}
          categories={data.categories}
          tags={data.tags}
          pending={pending === "save:new"}
          onCancel={() => setCreating(false)}
          onSave={(value) =>
            run("save:new", async () => {
              await adminSaveAutomation({ data: { id: null, data: value } });
              setCreating(false);
            }, "Automation created. Enable it and set a schedule when you are ready.")
          }
        />
      ) : null}

      <ul className="auto-list">
        {data.automations.map((automation) => {
          const schedule = automation.schedule;
          return (
            <li key={automation.id} className={automation.enabled && !automation.paused ? "auto-card" : "auto-card is-off"}>
              <div className="auto-card__head">
                <div>
                  <h2>
                    {automation.name}
                    {automation.mcpDefault ? <span className="desk-status">MCP default</span> : null}
                    {automation.mode === "mcp-connector" ? <span className="desk-status">Client-driven</span> : <span className="desk-status desk-status--published">Site-run</span>}
                  </h2>
                  <p className="desk-note">
                    {PROVIDER_LABELS[automation.provider]}
                    {automation.model ? ` · ${automation.model}` : ""} · {automation.scheduleText}
                  </p>
                  <p className="desk-note">{automation.credential}</p>
                </div>
                <div className="adm-row-actions">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={pending !== null}
                    onClick={() => void run(`toggle:${automation.id}`, () => adminSaveAutomation({ data: { id: automation.id, data: { ...stripRecord(automation), enabled: !automation.enabled } } }))}
                  >
                    {automation.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={pending !== null}
                    onClick={() => void run(`pause:${automation.id}`, () => adminSaveAutomation({ data: { id: automation.id, data: { ...stripRecord(automation), paused: !automation.paused } } }))}
                  >
                    {automation.paused ? "Resume" : "Pause"}
                  </button>
                  <button type="button" className="btn" onClick={() => { setEditing(editing === automation.id ? null : automation.id); setCreating(false); }}>
                    {editing === automation.id ? "Close" : "Edit"}
                  </button>
                </div>
              </div>

              <dl className="auto-facts">
                <div>
                  <dt>Status</dt>
                  <dd>{automation.enabled ? (automation.paused ? "Paused" : "Active") : "Disabled"}</dd>
                </div>
                <div>
                  <dt>Runs logged</dt>
                  <dd>
                    {automation.counts.total} ({automation.counts.failed} failed)
                  </dd>
                </div>
                <div>
                  <dt>Next run</dt>
                  <dd>{schedule?.nextRunAt ? formatStamp(schedule.nextRunAt) : automation.scheduleCron ? "Not scheduled yet (runs on the next tick)" : "No schedule set"}</dd>
                </div>
                <div>
                  <dt>Last time</dt>
                  <dd>
                    {schedule?.lastRunAt ? `${formatStamp(schedule.lastRunAt)} — ${schedule.lastStatus}${schedule.failureStreak > 0 ? ` (failed ${schedule.failureStreak}×)` : ""}` : "Never"}
                  </dd>
                </div>
              </dl>
              {schedule?.lastReason ? <p className="field-help">{schedule.lastReason}</p> : null}
              {!automation.enabled || automation.paused ? <p className="field-help">{automation.runnableReason}</p> : null}

              <div className="inline-actions">
                <button type="button" className="btn" disabled={pending !== null} onClick={() => void onRun(automation.id, false)}>
                  {pending === `run:${automation.id}:false` ? "Running…" : "Run now"}
                </button>
                <button type="button" className="btn btn--ghost" disabled={pending !== null} onClick={() => void onRun(automation.id, true)}>
                  {pending === `run:${automation.id}:true` ? "Preparing…" : "Dry run"}
                </button>
                <button type="button" className="btn btn--ghost" disabled={pending !== null} onClick={() => void onTest(automation.id)}>
                  {pending === `test:${automation.id}` ? "Testing…" : "Test connection"}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={pending !== null}
                  onClick={() => void run(`dup:${automation.id}`, () => adminDuplicateAutomation({ data: { id: automation.id } }), "Duplicated. The copy starts disabled.")}
                >
                  Duplicate
                </button>
                {confirmDelete === automation.id ? (
                  <>
                    <button
                      type="button"
                      className="btn btn--danger"
                      disabled={pending !== null}
                      onClick={() =>
                        void run(`del:${automation.id}`, async () => {
                          await adminDeleteAutomation({ data: { id: automation.id } });
                          setConfirmDelete(null);
                        }, "Automation deleted. Its history is kept.")
                      }
                    >
                      Delete permanently
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => setConfirmDelete(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn--danger-ghost" disabled={data.automations.length <= 1} onClick={() => setConfirmDelete(automation.id)} title={data.automations.length <= 1 ? "At least one automation must remain." : undefined}>
                    Delete
                  </button>
                )}
              </div>

              {test && test.id === automation.id ? (
                <p className={test.result.ok ? "banner banner--ok" : "banner banner--bad"} role="status">
                  {test.result.message}
                  {test.result.credential ? ` · ${test.result.credential}` : ""}
                </p>
              ) : null}

              {outcome && outcome.id === automation.id ? <OutcomePanel outcome={outcome.result} dryRun={outcome.dryRun} /> : null}

              {editing === automation.id ? (
                <AutomationForm
                  initial={stripRecord(automation)}
                  credentials={credentials}
                  categories={data.categories}
                  tags={data.tags}
                  pending={pending === `save:${automation.id}`}
                  onCancel={() => setEditing(null)}
                  onSave={(value) =>
                    run(`save:${automation.id}`, async () => {
                      await adminSaveAutomation({ data: { id: automation.id, data: value } });
                      setEditing(null);
                    }, "Saved. The schedule now uses these settings.")
                  }
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function formatStamp(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : formatDate(value);
}

/** Drops the read-only extras the loader adds, leaving the saveable fields. */
function stripRecord(automation: AutomationRecord): AutomationInput {
  const {
    id: _id,
    sortOrder: _sortOrder,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...rest
  } = automation;
  // The loader decorates records with display-only fields; only the schema
  // fields are ever sent back, and the server re-validates them anyway.
  const editable: Record<string, unknown> = { ...rest };
  for (const key of ["schedule", "counts", "active", "scheduleText", "credential", "runnable", "runnableReason"]) delete editable[key];
  return editable as unknown as AutomationInput;
}

function OutcomePanel({ outcome, dryRun }: { outcome: RunResult; dryRun: boolean }) {
  const tone = outcome.status === "failed" ? "banner banner--bad" : outcome.status === "skipped" ? "banner" : "banner banner--ok";
  return (
    <div className={tone} role="status" style={{ display: "grid", gap: "0.4rem" }}>
      <strong>
        {dryRun ? "Dry run" : "Run"} — {outcome.status} at stage “{outcome.stage}”
      </strong>
      <span>{outcome.reason}</span>
      {outcome.flags.length > 0 ? <span>Flags: {outcome.flags.join(", ")}</span> : null}
      {outcome.published ? <span>Published to the live site.</span> : null}
      {outcome.articleId ? <span>Article id: {outcome.articleId}</span> : null}
      {outcome.preview ? (
        <details>
          <summary>What would be written</summary>
          <p>
            <strong>{outcome.preview.title}</strong>
          </p>
          <p>{outcome.preview.excerpt}</p>
          <pre style={{ whiteSpace: "pre-wrap", maxHeight: "18rem", overflow: "auto" }}>{outcome.preview.body.slice(0, 4000)}</pre>
          <p className="field-help">{outcome.preview.blocks} block(s) · {outcome.preview.sources.length} source(s)</p>
        </details>
      ) : null}
    </div>
  );
}

function AutomationForm({
  initial,
  credentials,
  categories,
  tags,
  pending,
  onSave,
  onCancel,
}: {
  initial: AutomationInput;
  credentials: { name: string; configured: boolean; fingerprint: string | null; length: number | null }[];
  categories: { id: string; label: string }[];
  tags: { id: string; label: string }[];
  pending: boolean;
  onSave: (value: AutomationInput) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<AutomationInput>(initial);
  const patch = (next: Partial<AutomationInput>) => setValue((current) => ({ ...current, ...next }));
  const presets = cronPresets();
  const credentialLabel = (name: string) => {
    const found = credentials.find((item) => item.name === name);
    return found?.configured ? `${name} — set` : `${name} — not set`;
  };

  return (
    <form
      className="auto-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(value);
      }}
    >
      <fieldset className="block-card">
        <legend>Identity</legend>
        <div className="filters">
          <label className="field">
            <span>Name</span>
            <input value={value.name} maxLength={60} required onChange={(e) => patch({ name: e.target.value })} />
          </label>
          <label className="field">
            <span>How it runs</span>
            <select value={value.mode} onChange={(e) => patch({ mode: e.target.value as AutomationInput["mode"] })}>
              {AUTOMATION_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode === "mcp-connector" ? "An MCP client pushes drafts to /mcp" : "This site generates on a schedule"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="filters">
          <label className="check-row">
            <input type="checkbox" checked={value.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
            Enabled
          </label>
          <label className="check-row">
            <input type="checkbox" checked={value.paused} onChange={(e) => patch({ paused: e.target.checked })} />
            Paused
          </label>
          <label className="check-row">
            <input type="checkbox" checked={value.mcpDefault} onChange={(e) => patch({ mcpDefault: e.target.checked })} />
            Default for the shared MCP endpoint
          </label>
        </div>
      </fieldset>

      <fieldset className="block-card">
        <legend>Provider & credential</legend>
        <div className="filters">
          <label className="field">
            <span>Provider</span>
            <select value={value.provider} onChange={(e) => patch({ provider: e.target.value as AutomationInput["provider"], model: defaultModelFor(e.target.value as AutomationInput["provider"]) })}>
              {SERVER_API_PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {PROVIDER_LABELS[provider]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Model (blank = provider default)</span>
            <input value={value.model} maxLength={120} onChange={(e) => patch({ model: e.target.value })} />
          </label>
          {providerNeedsBaseUrl(value.provider) ? (
            <label className="field">
              <span>Base URL (https)</span>
              <input value={value.baseUrl} maxLength={300} onChange={(e) => patch({ baseUrl: e.target.value })} />
            </label>
          ) : null}
        </div>
        <label className="field">
          <span>Which Worker secret holds this automation's key</span>
          <select value={value.credentialRef} onChange={(e) => patch({ credentialRef: e.target.value as AutomationInput["credentialRef"] })}>
            <option value="">None (needed only for site-run automations)</option>
            {CREDENTIAL_REFS.map((ref) => (
              <option key={ref} value={ref}>
                {credentialLabel(ref)}
              </option>
            ))}
          </select>
        </label>
        <p className="field-help">
          Keys are never entered or shown here. Set one with <code>npx wrangler secret put AUTOMATION_A_KEY</code> and pick it above; the desk only ever
          reports whether it is set, plus a short fingerprint you can use to tell two keys apart.
        </p>
      </fieldset>

      <fieldset className="block-card">
        <legend>Topics</legend>
        <div className="filters">
          <label className="field">
            <span>Where topics come from</span>
            <select value={value.topicSource} onChange={(e) => patch({ topicSource: e.target.value as AutomationInput["topicSource"] })}>
              {TOPIC_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {TOPIC_SOURCE_LABELS[source]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Fallback topic for this automation</span>
            <select value={value.categoryId ?? ""} onChange={(e) => patch({ categoryId: e.target.value || null })}>
              <option value="">First available topic</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Topic list — one per line (up to 200)</span>
          <textarea
            value={value.topicIdeas.join("\n")}
            onChange={(e) => patch({ topicIdeas: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 200) })}
          />
        </label>
        <label className="field">
          <span>Source sites — one https URL per line (optional)</span>
          <textarea
            value={value.topicSources.join("\n")}
            onChange={(e) => patch({ topicSources: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 30) })}
          />
        </label>
        <fieldset className="builder-sub">
          <legend>Tags to apply</legend>
          {tags.length === 0 ? <p className="field-help">No tags yet.</p> : null}
          <div className="check-grid">
            {tags.map((tag) => (
              <label key={tag.id} className="check-row">
                <input
                  type="checkbox"
                  checked={value.tagIds.includes(tag.id)}
                  onChange={(e) => patch({ tagIds: e.target.checked ? [...value.tagIds, tag.id] : value.tagIds.filter((id) => id !== tag.id) })}
                />
                {tag.label}
              </label>
            ))}
          </div>
        </fieldset>
      </fieldset>

      <fieldset className="block-card">
        <legend>Writing</legend>
        <div className="filters">
          <label className="field">
            <span>Style</span>
            <select value={value.style} onChange={(e) => patch({ style: e.target.value as AutomationInput["style"] })}>
              {CONTENT_STYLES.map((style) => (
                <option key={style} value={style}>
                  {CONTENT_STYLE_LABELS[style]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Language</span>
            <input value={value.language} maxLength={12} onChange={(e) => patch({ language: e.target.value })} />
          </label>
          <label className="field">
            <span>Minimum words</span>
            <input type="number" min={120} max={6000} value={value.minWords} onChange={(e) => patch({ minWords: Number(e.target.value) })} />
          </label>
        </div>
        <label className="field">
          <span>Extra instructions (optional)</span>
          <textarea value={value.instructions} maxLength={4000} onChange={(e) => patch({ instructions: e.target.value })} />
        </label>
        <div className="filters">
          <label className="field">
            <span>Featured image</span>
            <select value={value.imageMode} onChange={(e) => patch({ imageMode: e.target.value as AutomationInput["imageMode"] })}>
              {IMAGE_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode === "none" ? "No featured image (geometric plate)" : "Generate one with the provider (OpenAI/xAI)"}
                </option>
              ))}
            </select>
          </label>
          {value.imageMode === "provider" ? (
            <label className="field">
              <span>Image prompt (optional)</span>
              <input value={value.imagePrompt} maxLength={600} onChange={(e) => patch({ imagePrompt: e.target.value })} />
            </label>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="block-card">
        <legend>Publishing</legend>
        <div className="filters">
          <label className="field">
            <span>After a run</span>
            <select value={value.publishMode} onChange={(e) => patch({ publishMode: e.target.value as AutomationInput["publishMode"] })}>
              {PUBLISH_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode === "draft" ? "Save as a draft for me to review" : "Publish automatically when checks pass"}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Maximum publishes per day</span>
            <input type="number" min={0} max={20} value={value.maxPerDay} onChange={(e) => patch({ maxPerDay: Number(e.target.value) })} />
          </label>
        </div>
        <div className="filters">
          <label className="check-row">
            <input type="checkbox" checked={value.requireSources} onChange={(e) => patch({ requireSources: e.target.checked })} />
            Require listed sources
          </label>
          <label className="field" style={{ maxWidth: "10rem" }}>
            <span>Minimum sources</span>
            <input type="number" min={0} max={10} value={value.minSources} onChange={(e) => patch({ minSources: Number(e.target.value) })} />
          </label>
          <label className="check-row">
            <input type="checkbox" checked={value.requireCover} onChange={(e) => patch({ requireCover: e.target.checked })} />
            Require a featured image before publishing
          </label>
        </div>
        {value.publishMode === "auto" ? (
          <fieldset className="builder-sub">
            <legend>Topics this automation may publish into</legend>
            {categories.map((category) => (
              <label key={category.id} className="check-row">
                <input
                  type="checkbox"
                  checked={value.allowedCategoryIds.includes(category.id)}
                  onChange={(e) => patch({ allowedCategoryIds: e.target.checked ? [...value.allowedCategoryIds, category.id] : value.allowedCategoryIds.filter((id) => id !== category.id) })}
                />
                {category.label}
              </label>
            ))}
            <p className="field-help">Anything outside this list is saved as a draft instead of going live.</p>
          </fieldset>
        ) : null}
      </fieldset>

      <fieldset className="block-card">
        <legend>Schedule</legend>
        <div className="filters">
          <label className="field">
            <span>Preset</span>
            <select
              value={presets.some((preset) => preset.cron === value.scheduleCron) ? value.scheduleCron : ""}
              onChange={(e) => {
                if (e.target.value) patch({ scheduleCron: e.target.value });
              }}
            >
              <option value="">Custom / none</option>
              {presets.map((preset) => (
                <option key={preset.cron} value={preset.cron}>
                  {preset.label} ({preset.cron})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Custom cron (minute hour day month weekday)</span>
            <input value={value.scheduleCron} maxLength={80} placeholder="0 8 * * *" onChange={(e) => patch({ scheduleCron: e.target.value })} />
          </label>
          <label className="field">
            <span>Timezone</span>
            <input value={value.timezone} maxLength={60} placeholder="UTC" onChange={(e) => patch({ timezone: e.target.value })} />
          </label>
        </div>
        <div className="filters">
          <label className="field">
            <span>Retries after a failure</span>
            <input type="number" min={0} max={3} value={value.retryMax} onChange={(e) => patch({ retryMax: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Seconds between retries</span>
            <input type="number" min={10} max={3600} value={value.retryBackoffSeconds} onChange={(e) => patch({ retryBackoffSeconds: Number(e.target.value) })} />
          </label>
        </div>
        <p className="field-help">
          Scheduled automations are checked by the Worker's cron trigger every five minutes (and by <code>/api/automation/tick</code> if you call it), so a run
          starts within five minutes of the chosen time. Times are interpreted in the timezone above.
        </p>
      </fieldset>

      <div className="inline-actions">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Saving…" : "Save automation"}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
