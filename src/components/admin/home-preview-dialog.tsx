import { useEffect, useRef, useState } from "react";

const SIZES = [
  { id: "desktop", label: "Desktop", width: null },
  { id: "tablet", label: "Tablet", width: 834 },
  { id: "phone", label: "Phone", width: 390 },
] as const;

/**
 * t217: large preview of the homepage builder's unsaved, in-memory draft. Uses the existing
 * /preview/home renderer (real public HomeBlocks) in an iframe, so public CSS stays inside the
 * frame. The draft goes over same-origin postMessage only; nothing is stored or published.
 */
export function HomePreviewDialog({
  open,
  onClose,
  draft,
}: {
  open: boolean;
  onClose: () => void;
  draft: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [size, setSize] = useState<(typeof SIZES)[number]["id"]>("desktop");
  const send = () =>
    frame.current?.contentWindow?.postMessage(
      { type: "dypol-home-draft", draft },
      window.location.origin,
    );

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // t217: the frame announces when its listener is attached; answer with the current draft.
  useEffect(() => {
    if (!open) return;
    const onReady = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow)
        return;
      if ((event.data as { type?: string })?.type === "dypol-home-ready") send();
    };
    window.addEventListener("message", onReady);
    return () => window.removeEventListener("message", onReady);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft]);

  // While open, later edits (if any) reach the frame too.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(send, 150);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, open]);

  const width = SIZES.find((s) => s.id === size)!.width;
  return (
    <dialog
      ref={dialog}
      className="adm-previewdlg"
      aria-labelledby="home-preview-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <div className="adm-previewdlg__bar">
        <h2 id="home-preview-title" className="adm-previewdlg__title">
          Homepage preview{" "}
          <span className="adm-previewdlg__badge">Unsaved — visitors don't see this</span>
        </h2>
        <div className="adm-previewdlg__sizes" role="group" aria-label="Preview width">
          {SIZES.map((s) => (
            <button
              key={s.id}
              type="button"
              className="btn btn--ghost"
              aria-pressed={size === s.id}
              onClick={() => setSize(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={onClose} autoFocus>
          Close preview
        </button>
      </div>
      <div className="adm-previewdlg__stage">
        {open ? (
          <iframe
            ref={frame}
            title="Homepage preview (unsaved)"
            src="/preview/home"
            onLoad={send}
            style={width ? { width: `${width}px` } : undefined}
          />
        ) : null}
      </div>
    </dialog>
  );
}
