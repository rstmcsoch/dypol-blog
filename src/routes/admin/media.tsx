import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import { adminBackfillMedia, adminDeleteMedia, adminMedia, adminUploadMedia } from "@/content/admin-api";

export const Route = createFileRoute("/admin/media")({
  loader: () => adminMedia(),
  component: MediaDesk,
});

function MediaDesk() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  return (
    <>
      <p className="desk-kicker">Library</p>
      <h1 className="desk-title">Media</h1>
      <p className="desk-note">
        Images go in the existing dypol-blog-media bucket through the MEDIA binding. The file name, alt text, and
        size are recorded in D1. JPEG, PNG, WebP, and GIF, up to 10 MB. Uploads are optimized once into a
        1280×720 WebP hero and a 480×360 WebP thumb.
      </p>
      <div className="stack" style={{ marginTop: "1rem" }}>
        <p className="desk-note">
          Legacy images uploaded before the image pipeline have no variants yet. Preview the backfill first —
          it changes nothing — then run it in batches. It is safe to re-run: images that already have variants
          are skipped.
        </p>
        <div>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={pending}
            onClick={() => {
              setPending(true);
              setError(null);
              void adminBackfillMedia({ data: { apply: false, limit: 25 } })
                .then((report) => setMessage(`Backfill preview: ${report.scanned} legacy image(s) in the next batch. Nothing was changed.`))
                .catch((caught: unknown) => setError(errorText(caught)))
                .finally(() => setPending(false));
            }}
          >
            Preview backfill
          </button>{" "}
          <button
            type="button"
            className="btn"
            disabled={pending}
            onClick={() => {
              setPending(true);
              setError(null);
              void adminBackfillMedia({ data: { apply: true, limit: 10 } })
                .then(async (report) => {
                  setMessage(
                    `Backfill batch done: ${report.processed} processed, ${report.skipped} skipped, ${report.failures.length} failed (${report.transformsUsed} transforms used).` +
                      (report.failures.length ? ` First failure: ${report.failures[0]?.error}` : ""),
                  );
                  await router.invalidate();
                })
                .catch((caught: unknown) => setError(errorText(caught)))
                .finally(() => setPending(false));
            }}
          >
            Run backfill batch (10)
          </button>
        </div>
      </div>
      {data.notice ? (
        <p className="banner banner--bad" role="alert">
          {data.notice}
        </p>
      ) : null}
      {error ? (
        <p className="banner banner--bad" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="banner" role="status">
          {message}
        </p>
      ) : null}
      <form
        className="stack"
        style={{ marginTop: "1rem" }}
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
          const alt = String(new FormData(form).get("alt") ?? "");
          if (!file) return;
          setPending(true);
          setError(null);
          const reader = new FileReader();
          reader.onload = () => {
            void adminUploadMedia({
              data: {
                filename: file.name,
                mime: file.type,
                alt,
                dataBase64: String(reader.result ?? ""),
              },
            })
              .then(async () => {
                setMessage("Uploaded.");
                form.reset();
                await router.invalidate();
              })
              .catch((caught: unknown) => setError(errorText(caught)))
              .finally(() => setPending(false));
          };
          reader.readAsDataURL(file);
        }}
      >
        <label className="field">
          <span>File</span>
          <input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required />
        </label>
        <label className="field">
          <span>Alt text</span>
          <input name="alt" />
        </label>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Uploading…" : "Upload"}
        </button>
      </form>
      <label className="field" style={{ marginTop: "1rem", maxWidth: "24rem" }}>
        <span>Search the library</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filename or alt text…" />
      </label>
      {data.media.length === 0 ? <p className="desk-note">The library is empty.</p> : null}
      <div className="media-grid">
        {data.media
          .filter((item) => !query.trim() || `${item.filename} ${item.alt}`.toLowerCase().includes(query.trim().toLowerCase()))
          .map((item) => (
          <article key={item.id} className="media-card">
            <img src={`/media/${item.id}`} alt={item.alt || ""} />
            <div>
              <p>{item.filename}</p>
              <p>{Math.max(1, Math.round(item.bytes / 1024))} KB original</p>
              {item.hasVariants ? (
                <p>
                  {item.width}×{item.height} · hero {Math.max(1, Math.round(item.heroBytes / 1024))} KB · thumb{" "}
                  {Math.max(1, Math.round(item.thumbBytes / 1024))} KB
                </p>
              ) : (
                <p>Legacy file — not optimized yet (run the variant backfill).</p>
              )}
              {confirmId === item.id ? (
                <>
                  <p>Delete this file?</p>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      void adminDeleteMedia({ data: { id: item.id } })
                        .then(async () => {
                          setMessage("Deleted.");
                          setConfirmId(null);
                          await router.invalidate();
                        })
                        .catch((caught: unknown) => setError(errorText(caught)));
                    }}
                  >
                    Delete
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => setConfirmId(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn--ghost" onClick={() => setConfirmId(item.id)}>
                  Delete
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
