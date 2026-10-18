import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import { adminDeletePageFn, adminPages, adminSavePageFn } from "@/content/admin-api";
import { slugifyPageTitle } from "@/lib/pages";

export const Route = createFileRoute("/admin/pages")({
  loader: () => adminPages(),
  component: PagesDesk,
});

type PageRow = Awaited<ReturnType<typeof adminPages>>[number];

const emptyDraft = { id: "", slug: "", title: "", body: "", status: "published" as "published" | "hidden" };

function PagesDesk() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [draft, setDraft] = useState<typeof emptyDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, success: string) {
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      await router.invalidate();
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  function edit(page: PageRow) {
    setDraft({ id: page.id, slug: page.slug, title: page.title, body: page.body, status: page.status === "hidden" ? "hidden" : "published" });
    setConfirmDeleteId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <>
      <p className="desk-kicker">Site</p>
      <h1 className="desk-title">Pages</h1>
      <p className="desk-note">
        The standard reader-facing pages — About, Privacy, Terms, DMCA, Cookie, Editorial, Corrections, Contact, Disclaimer — plus any page you add.
        Published pages appear in the footer and the sitemap at <code>/{`{slug}`}</code>. Hiding a page removes it everywhere without deleting it.
        The AI has no access to pages: only an admin can change them.
      </p>
      {error ? (
        <p className="banner banner--bad" role="alert">{error}</p>
      ) : null}
      {message ? (
        <p className="banner" role="status">{message}</p>
      ) : null}

      <section className="desk-section">
        <h2>{draft.id ? `Edit page` : "New page"}</h2>
        <form
          className="block-card"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => adminSavePageFn({ data: draft.id ? draft : { slug: draft.slug, title: draft.title, body: draft.body, status: draft.status } }),
              draft.id ? "Page saved." : "Page created.",
            ).then(() => setDraft(emptyDraft));
          }}>
          <label className="field">
            <span>Title</span>
            <input
              value={draft.title}
              required
              onChange={(e) => {
                const title = e.target.value;
                setDraft((d) => ({ ...d, title, slug: d.id ? d.slug : d.slug || slugifyPageTitle(title) }));
              }}
            />
          </label>
          <label className="field">
            <span>Slug (web address)</span>
            <input
              value={draft.slug}
              required
              onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value.trim().toLowerCase() }))}
            />
          </label>
          <label className="field">
            <span>Status</span>
            <select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as "published" | "hidden" }))}>
              <option value="published">Published (visible to readers)</option>
              <option value="hidden">Hidden (not on the site)</option>
            </select>
          </label>
          <label className="field">
            <span>Body — plain text with light markdown: ## headings, - lists, **bold**, [link text](/path)</span>
            <textarea value={draft.body} required rows={18} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
          </label>
          <div className="row">
            <button type="submit" className="btn btn--primary">{draft.id ? "Save page" : "Create page"}</button>
            {draft.id ? (
              <button type="button" className="btn" onClick={() => setDraft(emptyDraft)}>Cancel editing</button>
            ) : null}
            {draft.slug ? (
              <a className="btn" href={`/${draft.slug}`} target="_blank" rel="noreferrer">Preview /{draft.slug}</a>
            ) : null}
          </div>
        </form>
      </section>

      <section className="desk-section">
        <h2>All pages</h2>
        {data.map((page) => (
          <div key={page.id} className="block-card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>
                {page.title} <span className="muted">/{page.slug}</span>{" "}
                <span className={page.status === "published" ? "badge" : "badge badge--bad"}>{page.status}</span>{" "}
                {page.standard ? <span className="badge">standard</span> : null}
              </strong>
              <span className="row">
                <button type="button" className="btn btn--sm" onClick={() => edit(page)}>Edit</button>
                {confirmDeleteId === page.id ? (
                  <>
                    <button
                      type="button"
                      className="btn btn--sm btn--danger"
                      onClick={() => void run(() => adminDeletePageFn({ data: { id: page.id } }), "Page deleted.").then(() => setConfirmDeleteId(null))}>
                      Confirm delete
                    </button>
                    <button type="button" className="btn btn--sm" onClick={() => setConfirmDeleteId(null)}>Keep</button>
                  </>
                ) : (
                  <button type="button" className="btn btn--sm" onClick={() => setConfirmDeleteId(page.id)}>Delete</button>
                )}
              </span>
            </div>
            <p className="muted">Last updated {new Date(page.updated_at).toLocaleString("en-GB")}</p>
          </div>
        ))}
        {data.length === 0 ? <p className="desk-note">No pages yet. Create the first one above.</p> : null}
      </section>
    </>
  );
}
