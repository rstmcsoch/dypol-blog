import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { adminAutomation } from "@/content/admin-api";

export const Route = createFileRoute("/admin/automation/history")({
  loader: () => adminAutomation(),
  component: AutomationHistory,
});

function StatusChip({ status }: { status: string }) {
  const tone = status === "succeeded" || status === "published" ? "desk-status desk-status--published" : status === "failed" ? "desk-status desk-status--failed" : "desk-status";
  return <span className={tone}>{status || "unknown"}</span>;
}

function AutomationHistory() {
  const data = Route.useLoaderData();
  const [automationId, setAutomationId] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  const runs = useMemo(
    () =>
      data.runs.filter((run) => {
        if (automationId && run.automationId !== automationId) return false;
        if (status && run.status !== status && run.outcome !== status) return false;
        return true;
      }),
    [data.runs, automationId, status],
  );

  const nameOf = (id: string | null) => (id ? (data.automations.find((item) => item.id === id)?.name ?? id) : "MCP / manual");

  return (
    <>
      <p className="desk-kicker">Automation</p>
      <h1 className="desk-title">History & diagnostics</h1>
      <p className="desk-note">Every run this site recorded, per automation, with the stage that failed and why. Credentials are never shown.</p>

      <section className="desk-section">
        <h2>Health</h2>
        <dl className="auto-facts">
          <div>
            <dt>MCP endpoint</dt>
            <dd>{data.mcpTokenConfigured ? "Enabled (MCP_TOKEN set)" : "Disabled (no MCP_TOKEN secret)"}</dd>
          </div>
          <div>
            <dt>Tick authorisation</dt>
            <dd>{data.cronSecretConfigured ? "CRON_SECRET is set" : "Falls back to MCP_TOKEN"}</dd>
          </div>
          <div>
            <dt>Scheduler</dt>
            <dd>Cron trigger every 5 minutes + /api/automation/tick</dd>
          </div>
        </dl>
        <div className="desk-table-wrap">
          <table className="desk-table">
            <caption className="sr-only">Automations and their schedules</caption>
            <thead>
              <tr>
                <th scope="col">Automation</th>
                <th scope="col">State</th>
                <th scope="col">Schedule</th>
                <th scope="col">Next run</th>
                <th scope="col">Last run</th>
                <th scope="col">Failures in a row</th>
                <th scope="col">Runs</th>
              </tr>
            </thead>
            <tbody>
              {data.automations.map((automation) => (
                <tr key={automation.id}>
                  <th scope="row">{automation.name}</th>
                  <td>{automation.enabled ? (automation.paused ? "Paused" : "Active") : "Disabled"}</td>
                  <td>{automation.scheduleText}</td>
                  <td>{automation.schedule?.nextRunAt ? new Date(automation.schedule.nextRunAt).toISOString().replace("T", " ").slice(0, 16) : "—"}</td>
                  <td>
                    {automation.schedule?.lastRunAt
                      ? `${automation.schedule.lastRunAt.slice(0, 16).replace("T", " ")} · ${automation.schedule.lastStatus}`
                      : "never"}
                  </td>
                  <td>{automation.schedule?.failureStreak ?? 0}</td>
                  <td>
                    {automation.counts.total} ({automation.counts.failed} failed)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.automations.some((automation) => (automation.schedule?.failureStreak ?? 0) > 0) ? (
          <p className="banner banner--bad" role="alert">
            At least one automation has failed repeatedly. Open its row in <Link to="/admin/automation">Automations</Link> for the reason, then use “Test
            connection” or a dry run.
          </p>
        ) : null}
      </section>

      <section className="desk-section">
        <h2>Credentials on this deployment</h2>
        <p className="desk-note">
          Only names, whether they are set, a short fingerprint and length. The value itself never leaves the Worker.
        </p>
        <div className="desk-table-wrap">
          <table className="desk-table">
            <thead>
              <tr>
                <th scope="col">Secret</th>
                <th scope="col">State</th>
                <th scope="col">Fingerprint</th>
                <th scope="col">Length</th>
              </tr>
            </thead>
            <tbody>
              {data.credentials.map((item) => (
                <tr key={item.name}>
                  <th scope="row">
                    <code>{item.name}</code>
                  </th>
                  <td>{item.configured ? "set" : "not set"}</td>
                  <td>{item.fingerprint ?? "—"}</td>
                  <td>{item.length ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="desk-section">
        <h2>Run log</h2>
        <div className="filters">
          <label className="field">
            <span>Automation</span>
            <select value={automationId} onChange={(event) => setAutomationId(event.target.value)}>
              <option value="">All</option>
              {data.automations.map((automation) => (
                <option key={automation.id} value={automation.id}>
                  {automation.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All</option>
              {["succeeded", "draft", "failed", "skipped", "dry-run"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        {runs.length === 0 ? (
          <p className="desk-note">No runs recorded yet. A dry run is a safe way to produce the first entry.</p>
        ) : (
          <div className="desk-table-wrap">
            <table className="desk-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Automation</th>
                  <th scope="col">Status</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Took</th>
                  <th scope="col">Attempt</th>
                  <th scope="col">Article</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{run.createdAt.slice(0, 16).replace("T", " ")}</td>
                    <th scope="row">{nameOf(run.automationId)}</th>
                    <td>
                      <StatusChip status={run.status || run.outcome} />
                    </td>
                    <td>{run.stage || "—"}</td>
                    <td>{run.reason || "—"}</td>
                    <td>{run.durationMs ? `${Math.round(run.durationMs / 100) / 10}s` : "—"}</td>
                    <td>{run.attempt}</td>
                    <td>{run.articleId ? <code>{run.articleId.slice(0, 8)}</code> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
