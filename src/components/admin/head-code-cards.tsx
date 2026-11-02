/** t183: Settings → Custom head code: an always-empty "add" box plus one card per saved entry. */
import { useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import { adminSaveHeadCode } from "@/content/admin-api";
import { checkHeadCode } from "@/lib/ads/head-html";
import {
  addHeadEntry, headEntries, headEntryKey, headNameFor, HEAD_NAME_MAX, moveHeadEntry, removeHeadEntry, replaceHeadEntry,
  type HeadChange, type HeadNames,
} from "@/lib/ads/head-entries";

type Props = { value: string; names: HeadNames; onSaved: (customHead: string, names: HeadNames) => void; confirm?: (message: string) => boolean };

export function HeadCodeCards({ value, names, onSaved, confirm = (m) => window.confirm(m) }: Props) {
  const router = useRouter();
  const entries = useMemo(() => headEntries(value), [value]);
  const [draft, setDraft] = useState("");
  const [draftName, setDraftName] = useState("");
  const [editing, setEditing] = useState<{ index: number; code: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const draftCheck = useMemo(() => (draft.trim() ? checkHeadCode(draft) : null), [draft]);

  const apply = async (change: HeadChange, success: string, after?: () => void) => {
    if ("error" in change) { setStatus({ ok: false, text: change.error }); return false; }
    setBusy(true);
    setStatus(null);
    try {
      const saved = await adminSaveHeadCode({ data: { code: change.code, expected: value, names: change.names } });
      onSaved(saved.customHead, saved.names);
      after?.();
      setStatus({ ok: true, text: success });
      void router.invalidate();
      return true;
    } catch (caught) {
      setStatus({ ok: false, text: errorText(caught) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const n = draftCheck?.tags.length ?? 0;
    void apply(addHeadEntry(value, names, draft, draftName), `Added ${n === 1 ? "1 entry" : `${n} entries`} to <head>. It is live on public pages now.`, () => { setDraft(""); setDraftName(""); });
  };

  return (
    <fieldset className="block-card head-code" id="custom-head-code">
      <legend>Custom head code</legend>
      <p className="field-help">
        Paste verification tags (Google Search Console, Bing, Pinterest, Yandex), analytics or tag-manager scripts, link or style tags. The server places them inside
        &lt;head&gt; on every public page right after the consent tool’s code, in the order shown below, whether ads are on or off. Admin, API, MCP and sign-in pages
        never get them. Each change goes live as soon as it is saved, with no deploy.
      </p>
      <div className="head-code__add" data-testid="head-add">
        <label className="field">
          <span>Name (only you see this)</span>
          <input value={draftName} maxLength={HEAD_NAME_MAX} placeholder="e.g. Bing verification" onChange={(e) => setDraftName(e.target.value)} data-testid="head-add-name" />
        </label>
        <label className="field">
          <span>New head code</span>
          <textarea
            rows={5}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={'<meta name="google-site-verification" content="…" />'}
            data-testid="head-add-code"
          />
        </label>
        {draftCheck?.dropped.length ? (
          <div className="banner banner--bad head-code__dropped" role="alert">
            <strong>Will be removed</strong> (only meta, link, script, style and noscript belong in &lt;head&gt;; &lt;base&gt; is not allowed):
            <ul>{draftCheck.dropped.map((d, i) => <li key={i}><code>{d}</code></li>)}</ul>
          </div>
        ) : null}
        <div className="inline-actions">
          <button type="button" className="btn" disabled={busy || !draftCheck?.tags.length} onClick={add} data-testid="head-add-save">
            {busy ? "Saving…" : "Add to head"}
          </button>
          {draftCheck?.tags.length ? <span className="field-help">{draftCheck.tags.length} tag{draftCheck.tags.length === 1 ? "" : "s"} found</span> : null}
        </div>
      </div>
      {status ? (
        <p className={`banner ${status.ok ? "banner--ok" : "banner--bad"} head-code__status`} role={status.ok ? "status" : "alert"} data-testid="head-status">
          {status.text}
        </p>
      ) : null}
      <p className="head-code__count" data-testid="head-count">
        {entries.length ? `${entries.length} entr${entries.length === 1 ? "y" : "ies"} placed in <head>, in this order:` : "No head code yet."}
      </p>
      <ol className="head-cards" data-testid="head-cards">
        {entries.map((entry, i) => {
          const name = headNameFor(names, entry, i);
          const isEditing = editing?.index === i;
          return (
            <li key={`${headEntryKey(entry.code)}-${i}`} className={`head-card${isEditing ? " is-editing" : ""}`} data-testid={`head-card-${i}`}>
              <div className="head-card__top">
                <span className="head-card__num" aria-hidden="true">{i + 1}</span>
                <div className="head-card__title">
                  <h3 className="head-card__name" data-testid="head-card-name">{name}</h3>
                  <p className="head-card__meta">
                    <code className="head-code__tag" data-testid="head-card-tag">{entry.tag}</code>
                    <span className="head-card__sum">{entry.summary}</span>
                  </p>
                </div>
              </div>
              {isEditing ? (
                <div className="head-card__edit">
                  <label className="field">
                    <span>Name</span>
                    <input value={editing.name} maxLength={HEAD_NAME_MAX} onChange={(e) => setEditing({ ...editing, name: e.target.value })} data-testid="head-edit-name" />
                  </label>
                  <label className="field">
                    <span>Code</span>
                    <textarea rows={8} spellCheck={false} autoCapitalize="off" autoCorrect="off" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} data-testid="head-edit-code" />
                  </label>
                  <div className="inline-actions">
                    <button type="button" className="btn" disabled={busy} data-testid="head-edit-save"
                      onClick={() => void apply(replaceHeadEntry(value, names, i, editing.code, editing.name), `Saved “${editing.name.trim() || name}”. The change is live now.`, () => setEditing(null))}>
                      {busy ? "Saving…" : "Save"}
                    </button>
                    <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setEditing(null)} data-testid="head-edit-cancel">Cancel</button>
                  </div>
                </div>
              ) : null}
              <div className="head-card__actions">
                <button type="button" className="btn btn--ghost head-card__btn" aria-label={`Move ${name} up`} disabled={busy || i === 0} data-testid="head-up"
                  onClick={() => void apply(moveHeadEntry(value, names, i, -1), `Moved “${name}” up. The new order is live now.`, () => setEditing(null))}>↑ Up</button>
                <button type="button" className="btn btn--ghost head-card__btn" aria-label={`Move ${name} down`} disabled={busy || i === entries.length - 1} data-testid="head-down"
                  onClick={() => void apply(moveHeadEntry(value, names, i, 1), `Moved “${name}” down. The new order is live now.`, () => setEditing(null))}>↓ Down</button>
                <span className="head-card__spacer" />
                {!isEditing ? (
                  <button type="button" className="btn btn--ghost head-card__btn" disabled={busy} data-testid="head-edit" onClick={() => setEditing({ index: i, code: entry.code, name })}>Edit</button>
                ) : null}
                <button type="button" className="btn btn--ghost head-card__btn head-card__del" disabled={busy} data-testid="head-delete"
                  onClick={() => { if (confirm(`Delete “${name}” from <head>? It is removed from every public page at once.`)) void apply(removeHeadEntry(value, names, i), `Deleted “${name}”. It is no longer in <head>.`, () => setEditing(null)); }}>
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="field-help">
        Ad-network code (AdSense Auto ads, Adsterra Popunder / Social Bar) stays under <a href="/admin/ads">Ads → Scripts &amp; ads.txt</a>, and the certified consent tool under{" "}
        <a href="/admin/ads">Ads → Settings</a>; that code obeys the ads switch and consent rules.
      </p>
    </fieldset>
  );
}
