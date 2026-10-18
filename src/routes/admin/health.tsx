import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import { adminHealth, adminImportSettings } from "@/content/admin-api";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/admin/health")({
  loader: () => adminHealth(),
  component: HealthDesk,
});

function kb(bytes: number): string {
  return `${Math.max(0, Math.round(bytes / 1024)).toLocaleString()} KB`;
}

function HealthDesk() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <>
      <p className="desk-kicker">System</p>
      <h1 className="desk-title">Site health</h1>
      <p className="desk-note">A quick picture of your site, plus a settings backup you can keep.</p>
      {error ? <p className="banner banner--bad" role="alert">{error}</p> : null}
      {message ? <p className="banner" role="status">{message}</p> : null}
      <div className="stat-grid">
        <p className="stat"><strong>{data.counts.published}</strong><span>Published</span></p>
        <p className="stat"><strong>{data.counts.draft}</strong><span>Drafts</span></p>
        <p className="stat"><strong>{data.counts.scheduled}</strong><span>Scheduled</span></p>
        <p className="stat"><strong>{data.totalViews.toLocaleString()}</strong><span>Total views</span></p>
        <p className="stat"><strong>{data.counts.mediaFiles}</strong><span>Media files</span></p>
        <p className="stat"><strong>{data.counts.orphanMedia}</strong><span>Media not used anywhere</span></p>
      </div>
      <section className="desk-section">
        <h2>Storage</h2>
        <p className="desk-note">
          Stored now: {kb(data.storage.storedBytes)} (hero + thumbnail variants {kb(data.storage.variantBytes)}).
          Originals as uploaded: {kb(data.storage.originalBytes)}. The image pipeline keeps articles light — see Media.
        </p>
        <p className="desk-note">
          Last automation run: {data.lastAutomationRun ? formatDate(data.lastAutomationRun) : "none recorded"}.
          Scheduled articles publish on the first site or admin visit after their time (there is no background
          timer), so keep that in mind for exact timings.
        </p>
      </section>
      <section className="desk-section">
        <h2>Feeds &amp; search engines</h2>
        <p className="adm-row-actions">
          <a className="btn btn--ghost" href="/sitemap.xml" target="_blank" rel="noreferrer">Sitemap</a>
          <a className="btn btn--ghost" href="/news-sitemap.xml" target="_blank" rel="noreferrer">News sitemap</a>
          <a className="btn btn--ghost" href="/feed.xml" target="_blank" rel="noreferrer">RSS feed</a>
          <a className="btn btn--ghost" href="/robots.txt" target="_blank" rel="noreferrer">robots.txt</a>
        </p>
      </section>
      <section className="desk-section">
        <h2>Settings backup</h2>
        <p className="desk-note">
          Download a JSON backup of your site settings and automation settings (no articles, no secrets). Keep
          it somewhere safe; restoring replaces the current settings with the backup.
        </p>
        <p className="adm-row-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              const blob = new Blob([JSON.stringify(data.backup, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `dypol-settings-backup-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download settings backup
          </button>
          <label className="btn btn--ghost">
            Restore from backup…
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setPending(true);
                setError(null);
                void file
                  .text()
                  .then((text) => adminImportSettings({ data: JSON.parse(text) as unknown }))
                  .then(async (result) => {
                    setMessage(`Restored${result.site ? " site settings" : ""}${result.automation ? " + automation settings" : ""}.`);
                    await router.invalidate();
                  })
                  .catch((caught: unknown) => setError(errorText(caught)))
                  .finally(() => setPending(false));
              }}
            />
          </label>
          {pending ? <span className="desk-note">Restoring…</span> : null}
        </p>
      </section>
    </>
  );
}
