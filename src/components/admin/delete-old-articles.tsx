import { useEffect, useRef, useState } from "react";
import { adminDeleteOldArticles, adminOldArticlesPreview } from "@/content/admin-api";
import { formatDate } from "@/lib/format";
import { errorText } from "./gate";

type Match = { id: string; slug: string; title: string; status: string; dateIso: string; basis: string };
type Preview = { cutoff: string; total: number; articles: Match[] };

const PRESETS = [
  { value: "week", label: "Older than 1 week" },
  { value: "month", label: "Older than 1 month" },
  { value: "3months", label: "Older than 3 months" },
  { value: "custom", label: "Custom number of days" },
] as const;

const SCOPES = [
  { value: "drafts-unpublished", label: "Drafts and unpublished (safest)" },
  { value: "drafts", label: "Drafts only" },
  { value: "unpublished", label: "Unpublished only" },
  { value: "published", label: "Published only" },
  { value: "all", label: "Everything — drafts, unpublished and published" },
] as const;

/** "Delete old articles" panel on the Articles page: live preview, then a confirmed bulk delete. Admin only. */
export function DeleteOldArticles({ onDeleted }: { onDeleted: () => void | Promise<void> }) {
  const [preset, setPreset] = useState<string>("month");
  const [customDays, setCustomDays] = useState(30);
  const [scope, setScope] = useState<string>("drafts-unpublished");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [agree, setAgree] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);

  const query = { preset, customDays: preset === "custom" ? customDays : undefined, scope };
  const includesPublished = scope === "published" || scope === "all";

  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      void adminOldArticlesPreview({ data: query })
        .then((p) => { if (live) { setPreview(p as Preview); setError(null); } })
        .catch((caught: unknown) => { if (live) setError(errorText(caught)); })
        .finally(() => { if (live) setLoading(false); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customDays, scope, refreshKey]);

  return (
    <section className="block-card" style={{ marginTop: "2rem" }} aria-labelledby="old-articles-head">
      <h2 id="old-articles-head" className="desk-kicker" style={{ marginTop: 0 }}>Delete old articles</h2>
      <p className="desk-note">
        Permanently delete many articles at once by age. An article's date is its <strong>publish date</strong> when
        published, otherwise its <strong>last-saved date</strong>. Only articles dated <em>before</em> the day you pick
        are matched. Cover image files stay in Media, exactly like deleting one article without ticking its cover box.
      </p>
      <div className="filters" style={{ alignItems: "end" }}>
        <label className="field">
          <span>Age</span>
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            {PRESETS.map((p) => (<option key={p.value} value={p.value}>{p.label}</option>))}
          </select>
        </label>
        {preset === "custom" ? (
          <label className="field">
            <span>Days old (1–3650)</span>
            <input type="number" min={1} max={3650} value={customDays} onChange={(e) => setCustomDays(Number(e.target.value))} />
          </label>
        ) : null}
        <label className="field">
          <span>Which articles</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            {SCOPES.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
          </select>
        </label>
      </div>
      {includesPublished ? (
        <p className="banner banner--bad" role="alert" style={{ marginTop: "0.75rem" }}>
          This includes <strong>published</strong> articles: they will disappear from the public site immediately and
          cannot be recovered.
        </p>
      ) : null}
      {error ? (<p className="banner banner--bad" role="alert" style={{ marginTop: "0.75rem" }}>{error}</p>) : null}
      {result ? (<p className="banner" role="status" style={{ marginTop: "0.75rem" }}>{result}</p>) : null}
      <div style={{ marginTop: "1rem" }}>
        <p className="desk-note" data-testid="old-preview-count">
          {loading || !preview
            ? "Working out what matches…"
            : preview.total === 0
              ? `Nothing matches. No articles in this group are dated before ${formatDate(preview.cutoff)}.`
              : `${preview.total} article${preview.total === 1 ? "" : "s"} dated before ${formatDate(preview.cutoff)} will be deleted:`}
        </p>
        {preview && preview.total > 0 ? (
          <div className="desk-table-wrap">
            <table className="desk-table">
              <thead><tr><th>Title</th><th>Status</th><th>Date used</th></tr></thead>
              <tbody>
                {preview.articles.map((a) => (
                  <tr key={a.id}>
                    <td>{a.title}<div className="desk-note">{a.slug}</div></td>
                    <td>{a.status}</td>
                    <td>{formatDate(a.dateIso)}<div className="desk-note">{a.basis}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.total > preview.articles.length ? <p className="desk-note">…and {preview.total - preview.articles.length} more (all {preview.total} will be deleted).</p> : null}
          </div>
        ) : null}
        <div className="inline-actions" style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            className="btn btn--danger"
            disabled={!preview || preview.total === 0}
            onClick={() => { setAgree(false); dialog.current?.showModal(); }}
          >
            Delete {preview?.total ?? 0} old article{preview?.total === 1 ? "" : "s"}…
          </button>
        </div>
      </div>

      <dialog ref={dialog} className="adm-dialog" aria-labelledby="old-del-title">
        <h2 id="old-del-title">Delete {preview?.total ?? 0} article{preview?.total === 1 ? "" : "s"} permanently?</h2>
        <p>
          Everything dated before <strong>{preview ? formatDate(preview.cutoff) : ""}</strong> in the group “
          {SCOPES.find((s) => s.value === scope)?.label}” will be removed permanently. This cannot be undone.
        </p>
        {includesPublished ? (
          <p className="banner banner--bad" role="alert">This includes published articles — they will disappear from the public site immediately.</p>
        ) : null}
        <label className="check-row" style={{ margin: "1rem 0" }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          I understand these {preview?.total ?? 0} articles will be permanently deleted
        </label>
        {error ? (<p className="banner banner--bad" role="alert">{error}</p>) : null}
        <div className="inline-actions" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn--ghost" onClick={() => dialog.current?.close()} disabled={pending}>Cancel</button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={!agree || pending}
            onClick={() => {
              setPending(true);
              setError(null);
              void adminDeleteOldArticles({ data: query })
                .then(async (r) => {
                  dialog.current?.close();
                  setResult(`Deleted ${r.total} article${r.total === 1 ? "" : "s"}: ${r.deleted.map((d) => d.title).slice(0, 5).join("; ")}${r.total > 5 ? `; and ${r.total - 5} more` : ""}.`);
                  setRefreshKey((k) => k + 1);
                  await onDeleted();
                })
                .catch((caught: unknown) => setError(errorText(caught)))
                .finally(() => setPending(false));
            }}
          >
            {pending ? "Deleting…" : `Delete ${preview?.total ?? 0} permanently`}
          </button>
        </div>
      </dialog>
    </section>
  );
}
