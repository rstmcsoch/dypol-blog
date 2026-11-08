import { useEffect, useReducer, useRef, useState } from "react";
import {
  isTrustedMessage,
  PREVIEW_INITIAL,
  PREVIEW_TIMEOUT_MS,
  previewReducer,
} from "@/lib/home-preview-protocol";

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
  const nextId = useRef(0);
  const [size, setSize] = useState<(typeof SIZES)[number]["id"]>("desktop");
  const [state, dispatch] = useReducer(previewReducer, PREVIEW_INITIAL);
  const [attempt, setAttempt] = useState(0);
  const send = () => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    const id = ++nextId.current;
    dispatch({ type: "sent", id });
    win.postMessage({ type: "dypol-home-draft", draft, id }, window.location.origin);
  };

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
    if (open) dispatch({ type: "reset" });
  }, [open]);

  // t217: frame messages (same origin, from this frame only): ready -> send draft; applied/error -> state.
  useEffect(() => {
    if (!open) return;
    const onMessage = (event: MessageEvent) => {
      const win = frame.current?.contentWindow;
      const origin = window.location.origin;
      const id = (event.data as { id?: number })?.id ?? -1;
      if (isTrustedMessage(event, origin, win, "dypol-home-ready")) send();
      else if (isTrustedMessage(event, origin, win, "dypol-home-applied"))
        dispatch({ type: "applied", id });
      else if (isTrustedMessage(event, origin, win, "dypol-home-error"))
        dispatch({ type: "failed", id });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft]);

  // While open, later edits (if any) reach the frame too.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(send, 150);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, open]);

  // Never spin forever: no ack in time -> error with Retry.
  useEffect(() => {
    if (!open || state.status !== "loading") return;
    const id = state.sent;
    const timer = window.setTimeout(() => dispatch({ type: "timeout", id }), PREVIEW_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [open, state.status, state.sent, attempt]);

  const retry = () => {
    dispatch({ type: "reset" });
    setAttempt((n) => n + 1);
  };

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
      <div className="adm-previewdlg__stage" aria-busy={state.status === "loading"}>
        {open && state.status !== "ready" ? (
          <div
            className="adm-previewdlg__status"
            role={state.status === "error" ? "alert" : "status"}
          >
            {state.status === "error" ? (
              <>
                <span>The preview couldn't load your unsaved changes.</span>
                <button type="button" className="btn btn--ghost" onClick={retry}>
                  Retry
                </button>
              </>
            ) : (
              <span>Loading preview of your unsaved changes…</span>
            )}
          </div>
        ) : null}
        {open ? (
          <iframe
            key={attempt}
            ref={frame}
            title="Homepage preview (unsaved)"
            src="/preview/home"
            onLoad={send}
            data-state={state.status}
            aria-hidden={state.status !== "ready"}
            style={width ? { width: `${width}px` } : undefined}
          />
        ) : null}
      </div>
    </dialog>
  );
}
