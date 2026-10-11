import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import { adminDeleteMedia, adminMedia, adminUploadMedia } from "@/content/admin-api";

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

  return (
    <>
      <p className="desk-kicker">Library</p>
      <h1 className="desk-title">Media</h1>
      <p className="desk-note">
        Images go in the existing dypol-blog-media bucket through the MEDIA binding. The file name, alt text, and
        size are recorded in D1. JPEG, PNG, WebP, and GIF, up to 1.5 MB.
      </p>
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
      {data.media.length === 0 ? <p className="desk-note">The library is empty.</p> : null}
      <div className="media-grid">
        {data.media.map((item) => (
          <article key={item.id} className="media-card">
            <img src={`/media/${item.id}`} alt={item.alt || ""} />
            <div>
              <p>{item.filename}</p>
              <p>{Math.max(1, Math.round(item.bytes / 1024))} KB</p>
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
