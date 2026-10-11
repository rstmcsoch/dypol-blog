import { useRef, useState } from "react";
import { errorText } from "@/components/admin/gate";
import { adminDeleteArticle } from "@/content/admin-api";

/** Delete button + confirmation dialog. Works for any status, published included. */
export function DeleteArticleButton({
  id,
  title,
  status,
  hasCover,
  onDeleted,
  label = "Delete",
}: {
  id: string;
  title: string;
  status: string;
  hasCover: boolean;
  onDeleted: () => void | Promise<void>;
  label?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [deleteCover, setDeleteCover] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="btn btn--danger-ghost" onClick={() => dialog.current?.showModal()}>
        {label}
      </button>
      <dialog ref={dialog} className="adm-dialog" aria-labelledby={`del-${id}`}>
        <h2 id={`del-${id}`}>Delete this article?</h2>
        <p>
          “{title}” will be removed permanently{status === "published" ? " and disappears from the public site immediately" : ""}. This
          cannot be undone.
        </p>
        {hasCover ? (
          <label className="check-row" style={{ marginBottom: "1rem" }}>
            <input type="checkbox" checked={deleteCover} onChange={(e) => setDeleteCover(e.target.checked)} />
            Also delete the cover image file (kept if anything else uses it)
          </label>
        ) : null}
        {error ? (
          <p className="banner banner--bad" role="alert">
            {error}
          </p>
        ) : null}
        <div className="inline-actions" style={{ justifyContent: "flex-end", marginTop: "0.5rem" }}>
          <button type="button" className="btn btn--ghost" onClick={() => dialog.current?.close()} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={pending}
            onClick={() => {
              setPending(true);
              setError(null);
              void adminDeleteArticle({ data: { id, deleteCover } })
                .then(async () => {
                  dialog.current?.close();
                  await onDeleted();
                })
                .catch((caught: unknown) => setError(errorText(caught)))
                .finally(() => setPending(false));
            }}
          >
            {pending ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </dialog>
    </>
  );
}
