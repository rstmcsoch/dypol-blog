import { useEffect, useMemo, useRef, useState } from "react";
import { checkAuthorList, cursorAfterEdit, MAX_AUTHORS, moveItem, nextUpName } from "@/lib/author-rotation";
import { checkAuthorName } from "@/lib/author-name";

/**
 * t169: the "Authors" card on an automation profile. An ordered list of
 * bylines; every article the profile publishes takes the next one.
 * Reorder by dragging the handle (mouse or touch) or the up/down buttons.
 */
type Row = { key: string; name: string };
type Other = { name: string; authors: string[] };
type Saved = { names: string[]; nextIndex: number };

let seq = 0;
const rowsOf = (names: string[]): Row[] => names.map((name) => ({ key: `a${++seq}`, name }));

export function AuthorRotationCard(props: {
  profileId: string;
  profileName: string;
  authors: string[];
  nextAuthor: string | null;
  others: Other[];
  save: (names: string[], reset: boolean) => Promise<{ names: string[]; nextIndex: number; nextUp: string | null }>;
  onSaved?: () => unknown;
}) {
  const initialIndex = Math.max(0, props.nextAuthor ? props.authors.indexOf(props.nextAuthor) : 0);
  const [saved, setSaved] = useState<Saved>({ names: props.authors, nextIndex: initialIndex });
  const [rows, setRows] = useState<Row[]>(() => rowsOf(props.authors));
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLInputElement>(null);

  const names = rows.map((r) => r.name);
  const dirty = JSON.stringify(names.map((n) => n.replace(/\s+/g, " ").trim())) !== JSON.stringify(saved.names);
  // Sync when the server copy changes (e.g. another tab) and nothing is being edited.
  useEffect(() => {
    if (dirty) return;
    setSaved({ names: props.authors, nextIndex: initialIndex });
    setRows(rowsOf(props.authors));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.authors.join("\n"), props.nextAuthor]);

  const namesKey = JSON.stringify(names);
  const check = useMemo(() => checkAuthorList(JSON.parse(namesKey) as string[]), [namesKey]);
  const clash = useMemo(() => {
    if (!check.ok) return null;
    for (const n of check.names) {
      const o = props.others.find((p) => p.authors.some((a) => a.toLowerCase() === n.toLowerCase()));
      if (o) return `“${n}” is already an author on “${o.name}”. Each name belongs to one profile.`;
    }
    return null;
  }, [check, props.others]);
  const listError = check.ok ? clash : check.error;
  const previewNames = check.ok ? check.names : names;
  const previewIndex = previewNames.length ? cursorAfterEdit(saved.names, saved.nextIndex, previewNames) : 0;
  const nextUp = nextUpName(previewNames, previewIndex);

  const addProblem = (() => {
    const v = adding.replace(/\s+/g, " ").trim();
    if (!v) return null;
    const r = checkAuthorName(v);
    if (!r.ok) return r.error;
    if (names.some((n) => n.trim().toLowerCase() === v.toLowerCase())) return `“${v}” is already in the list.`;
    if (rows.length >= MAX_AUTHORS) return `Up to ${MAX_AUTHORS} authors per profile.`;
    return null;
  })();

  const touch = () => { setNotice(null); setError(null); };
  const setName = (i: number, name: string) => { touch(); setRows((rs) => rs.map((r, j) => (j === i ? { ...r, name } : r))); };
  const move = (from: number, to: number) => { touch(); setRows((rs) => moveItem(rs, from, to)); };
  const remove = (i: number) => { touch(); setRows((rs) => rs.filter((_, j) => j !== i)); };
  const add = () => {
    const v = adding.replace(/\s+/g, " ").trim();
    if (!v || addProblem) return;
    touch();
    setRows((rs) => [...rs, ...rowsOf([v])]);
    setAdding("");
    addRef.current?.focus();
  };

  const submit = (reset: boolean) => {
    if (listError) { setError(listError); return; }
    setBusy(true);
    setError(null);
    setNotice(null);
    void props.save(check.ok ? check.names : [], reset)
      .then(async (r) => {
        setSaved({ names: r.names, nextIndex: r.nextIndex });
        setRows(rowsOf(r.names));
        setNotice(
          r.names.length
            ? reset
              ? `Rotation reset. The next published article is by ${r.nextUp}.`
              : `Saved ✓ ${r.names.length} ${r.names.length === 1 ? "author" : "authors"}. Next published article: by ${r.nextUp}.`
            : "Saved ✓ No authors: this profile's articles show the site name.",
        );
        await props.onSaved?.();
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not save the authors."))
      .finally(() => setBusy(false));
  };

  // Pointer-based drag on the handle: works with mouse, pen and touch.
  const indexAt = (clientY: number): number => {
    const items = listRef.current ? Array.from(listRef.current.querySelectorAll<HTMLElement>("[data-row]")) : [];
    for (let i = 0; i < items.length; i++) {
      const box = items[i].getBoundingClientRect();
      if (clientY < box.top + box.height / 2) return i;
    }
    return Math.max(0, items.length - 1);
  };

  return (
    <section className="arot" aria-labelledby="arot-title" data-testid="author-rotation">
      <header className="arot__head">
        <span className="arot__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5" /><path d="M16 5.3a3 3 0 0 1 0 5.4" /><path d="M17.5 14.3c1.7.6 2.8 2.2 3 4.7" /></svg>
        </span>
        <div className="arot__heading">
          <h2 id="arot-title" className="arot__title">Authors <span className="arot__count">{rows.length}</span></h2>
          <p className="arot__sub">Each article {props.profileName} publishes gets the next name below, in order, then it starts again at #1. Bylines are saved on the article, so editing this list never changes older articles.</p>
        </div>
        <div className={`arot__next${nextUp ? "" : " is-empty"}`} data-testid="author-next" aria-live="polite">
          <span className="arot__next-label">Next up</span>
          <strong className="arot__next-name">{nextUp ?? "Site name (no authors)"}</strong>
          {nextUp ? <span className="arot__next-pos">#{previewIndex + 1} of {previewNames.length}</span> : null}
        </div>
      </header>

      {rows.length ? (
        <ol className="arot__list" ref={listRef} data-testid="author-list">
          {rows.map((row, i) => {
            const isNext = i === previewIndex && Boolean(nextUp);
            const dragging = drag?.from === i;
            const over = drag && drag.over === i && drag.from !== i;
            return (
              <li key={row.key} data-row className={`arot__row${isNext ? " is-next" : ""}${dragging ? " is-dragging" : ""}${over ? (drag && drag.from < i ? " is-over-after" : " is-over-before") : ""}`} data-testid="author-row">
                <button
                  type="button"
                  className="arot__handle"
                  aria-label={`Drag to reorder ${row.name || `author ${i + 1}`} (or use arrow keys)`}
                  title="Drag to reorder"
                  data-testid="author-handle"
                  onPointerDown={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag({ from: i, over: i }); }}
                  onPointerMove={(e) => { if (drag) { const over = indexAt(e.clientY); if (over !== drag.over) setDrag({ ...drag, over }); } }}
                  onPointerUp={() => { if (drag) { if (drag.over !== drag.from) move(drag.from, drag.over); setDrag(null); } }}
                  onPointerCancel={() => setDrag(null)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); move(i, i - 1); }
                    if (e.key === "ArrowDown" && i < rows.length - 1) { e.preventDefault(); move(i, i + 1); }
                  }}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
                </button>
                <span className="arot__num" aria-hidden="true">{i + 1}</span>
                <label className="arot__field">
                  <span className="sr-only">Author {i + 1}</span>
                  <input className="arot__name" value={row.name} maxLength={60} data-testid="author-name" onChange={(e) => setName(i, e.target.value)} />
                </label>
                {isNext ? <span className="arot__badge">Next</span> : null}
                <span className="arot__actions">
                  <button type="button" className="arot__icon-btn" aria-label={`Move ${row.name} up`} title="Move up" disabled={i === 0} data-testid="author-up" onClick={() => move(i, i - 1)}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg>
                  </button>
                  <button type="button" className="arot__icon-btn" aria-label={`Move ${row.name} down`} title="Move down" disabled={i === rows.length - 1} data-testid="author-down" onClick={() => move(i, i + 1)}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  <button type="button" className="arot__icon-btn arot__icon-btn--danger" aria-label={`Remove ${row.name}`} title="Remove" data-testid="author-remove" onClick={() => remove(i)}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16" /><path d="M9 7V4.8h6V7" /><path d="M6.5 7l.9 12.2h9.2L17.5 7" /></svg>
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="arot__empty" data-testid="author-empty">
          <strong>No authors yet.</strong> Articles from this profile show the site name (DYPOL LABS). Add one or more names to rotate bylines.
        </div>
      )}

      <form className="arot__add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <label className="arot__add-field">
          <span className="sr-only">New author name</span>
          <input ref={addRef} value={adding} maxLength={60} placeholder="Add an author name, e.g. John Daniel" data-testid="author-add-input" aria-invalid={addProblem ? true : undefined} onChange={(e) => setAdding(e.target.value)} />
        </label>
        <button type="submit" className="btn btn--ghost arot__add-btn" disabled={!adding.trim() || Boolean(addProblem)} data-testid="author-add">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          Add author
        </button>
        {addProblem ? <small className="arot__msg arot__msg--bad" role="alert">{addProblem}</small> : null}
      </form>

      <footer className="arot__foot">
        <div className="arot__foot-actions">
          <button type="button" className="btn" disabled={busy || !dirty || Boolean(listError)} data-testid="author-save" onClick={() => submit(false)}>
            {busy ? "Saving…" : "Save authors"}
          </button>
          {saved.names.length > 1 ? (
            <button type="button" className="arot__link" disabled={busy} data-testid="author-reset" onClick={() => { if (window.confirm(`Start the rotation again at #1 (${previewNames[0] ?? ""})?`)) submit(true); }}>
              Reset rotation
            </button>
          ) : null}
        </div>
        <div className="arot__status">
          {error || listError ? (
            <span className="arot__msg arot__msg--bad" role="alert" data-testid="author-error">{error ?? listError}</span>
          ) : notice ? (
            <span className="arot__msg arot__msg--ok" role="status" data-testid="author-saved">{notice}</span>
          ) : dirty ? (
            <span className="arot__msg arot__msg--warn">Unsaved changes</span>
          ) : (
            <span className="arot__msg">Saved separately from the automation settings below.</span>
          )}
        </div>
      </footer>
    </section>
  );
}
