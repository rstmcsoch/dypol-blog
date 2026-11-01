import { useState } from "react";
import { move } from "@/components/admin/site-form";
import {
  SHARE_KINDS,
  SHARE_KIND_NAMES,
  SHARE_NETWORKS,
  customTemplateError,
  defaultShareSettings,
  type ShareButton,
  type ShareKind,
  type ShareSettings,
} from "@/lib/share-buttons";

const HELP: Partial<Record<ShareKind, string>> = {
  copy: "Copies the article link. Default label comes from Site text.",
  native: "The phone's own share sheet. Only shown on devices/browsers that support it.",
  custom: "Your own link. Use {url} and {title}; they are encoded automatically. https:// only.",
};

/**
 * t148: share buttons for the article sidebar Share block — on/off, order (drag or
 * arrows), labels, more networks, custom links. Saved with site settings.
 */
export function ShareButtonsEditor({ value, onChange }: { value: ShareSettings; onChange: (next: ShareSettings) => void }) {
  const buttons = value.buttons;
  const [adding, setAdding] = useState<ShareKind>("whatsapp");
  const [drag, setDrag] = useState<number | null>(null);
  const set = (next: ShareButton[]) => onChange({ buttons: next });
  const update = (i: number, patch: Partial<ShareButton>) => set(buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const add = () =>
    set([
      ...buttons,
      {
        id: `share-${adding}-${Math.random().toString(36).slice(2, 8)}`,
        kind: adding,
        enabled: true,
        label: adding === "custom" ? "My link" : "",
        template: adding === "custom" ? "https://example.com/share?url={url}&title={title}" : "",
      },
    ]);
  return (
    <div className="stack adm-share" data-testid="share-buttons">
      <p className="adm-group__label">Share buttons (top to bottom = left to right)</p>
      {buttons.length === 0 ? <p className="field-help">No buttons: the Share block is hidden on articles.</p> : null}
      {buttons.map((b, i) => {
        const name = SHARE_KIND_NAMES[b.kind];
        const problem = b.kind === "custom" ? customTemplateError(b.template) : null;
        return (
          <div
            key={b.id}
            className={drag === i ? "block-card adm-block is-dragging" : "block-card adm-block"}
            data-share={b.kind}
            onDragOver={(e) => drag !== null && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (drag === null || drag === i) return;
              const next = [...buttons];
              const [item] = next.splice(drag, 1);
              next.splice(i, 0, item as ShareButton);
              set(next);
              setDrag(null);
            }}
          >
            <div className="filters" style={{ alignItems: "center" }}>
              <span className="adm-drag" draggable onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)} title="Drag to reorder" aria-hidden="true">
                ⋮⋮
              </span>
              <label className="check-row" style={{ flex: 1 }}>
                <input type="checkbox" checked={b.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
                <strong>{name}</strong>
                {b.enabled ? null : <span className="adm-muted"> (hidden)</span>}
              </label>
              <div className="adm-row-actions">
                <button type="button" className="btn btn--ghost" aria-label={`Move ${name} up`} disabled={i === 0} onClick={() => set(move(buttons, i, -1))}>
                  ↑
                </button>
                <button type="button" className="btn btn--ghost" aria-label={`Move ${name} down`} disabled={i === buttons.length - 1} onClick={() => set(move(buttons, i, 1))}>
                  ↓
                </button>
                <button type="button" className="btn btn--danger" aria-label={`Remove ${name}`} onClick={() => set(buttons.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            </div>
            {HELP[b.kind] ? <p className="field-help">{HELP[b.kind]}</p> : null}
            <div className="filters">
              <label className="field">
                <span>Label</span>
                <input value={b.label} placeholder={b.kind === "copy" ? "Copy link (from Site text)" : name} maxLength={40} onChange={(e) => update(i, { label: e.target.value })} />
              </label>
              {b.kind === "custom" ? (
                <label className="field" style={{ flex: 2 }}>
                  <span>Link template</span>
                  <input value={b.template} maxLength={500} placeholder="https://example.com/share?url={url}&title={title}" aria-invalid={problem ? true : undefined} onChange={(e) => update(i, { template: e.target.value })} />
                  {problem ? <small className="field-help" role="alert">{problem}</small> : null}
                </label>
              ) : b.kind in SHARE_NETWORKS ? (
                <p className="field-help" style={{ flex: 2, wordBreak: "break-all" }}>
                  {SHARE_NETWORKS[b.kind as keyof typeof SHARE_NETWORKS].template}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
      <div className="filters" style={{ alignItems: "end" }}>
        <label className="field">
          <span>Add a share button</span>
          <select value={adding} onChange={(e) => setAdding(e.target.value as ShareKind)} data-testid="share-add-type">
            {SHARE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k === "custom" ? "Custom link…" : SHARE_KIND_NAMES[k]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn--ghost" onClick={add} data-testid="share-add">
          Add button
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => onChange(defaultShareSettings())}>
          Reset to default 5
        </button>
      </div>
    </div>
  );
}
