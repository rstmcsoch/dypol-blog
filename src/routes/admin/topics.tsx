import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import {
  adminDeleteCategory,
  adminDeleteTag,
  adminSaveCategory,
  adminSaveTag,
  adminTaxonomy,
} from "@/content/admin-api";

export const Route = createFileRoute("/admin/topics")({
  loader: () => adminTaxonomy(),
  component: TopicsDesk,
});

function TopicsDesk() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  return (
    <>
      <p className="desk-kicker">Taxonomy</p>
      <h1 className="desk-title">Topics and tags</h1>
      <p className="desk-note">A topic or tag that is still used by an article cannot be deleted.</p>
      <p className="desk-note">These topics are the list the AI picks from: every AI article is filed under 1–4 of them by its content (an article can be under several topics at once). Renaming a topic renames it everywhere; articles keep working.</p>
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
      <section className="desk-section">
        <h2>Topics</h2>
        {data.categories.map((category) => {
          const count = data.articles.filter((article) => (article.topicIds ?? [article.categoryId]).includes(category.id)).length;
          return (
            <form
              key={category.id}
              className="block-card"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void run(
                  () =>
                    adminSaveCategory({
                      data: {
                        id: category.id,
                        label: String(form.get("label") ?? ""),
                        slug: String(form.get("slug") ?? ""),
                        description: String(form.get("description") ?? ""),
                      },
                    }),
                  "Topic saved.",
                );
              }}
            >
              <label className="field">
                <span>Label</span>
                <input name="label" defaultValue={category.label} required />
              </label>
              <label className="field">
                <span>Slug</span>
                <input name="slug" defaultValue={category.slug} />
              </label>
              <label className="field">
                <span>Description</span>
                <textarea name="description" defaultValue={category.description} />
              </label>
              <div className="inline-actions">
                <button className="btn" type="submit">
                  Save
                </button>
                <button
                  className="btn btn--ghost"
                  type="button"
                  onClick={() => {
                    if (count > 0) {
                      setError("Move the articles in this topic to another topic before deleting it.");
                      return;
                    }
                    void run(() => adminDeleteCategory({ data: { id: category.id } }), "Topic deleted.");
                  }}
                >
                  Delete ({count} articles)
                </button>
              </div>
            </form>
          );
        })}
        <form
          className="block-card"
          onSubmit={(event) => {
            event.preventDefault();
            const formEl = event.currentTarget;
            const form = new FormData(formEl);
            void run(async () => {
              await adminSaveCategory({
                data: {
                  id: null,
                  label: String(form.get("label") ?? ""),
                  slug: String(form.get("slug") ?? ""),
                  description: String(form.get("description") ?? ""),
                },
              });
              formEl.reset();
            }, "Topic created.");
          }}
        >
          <h3>New topic</h3>
          <label className="field">
            <span>Label</span>
            <input name="label" required />
          </label>
          <label className="field">
            <span>Slug</span>
            <input name="slug" />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea name="description" />
          </label>
          <button className="btn" type="submit">
            Create topic
          </button>
        </form>
      </section>
      <section className="desk-section">
        <h2>Tags</h2>
        {data.tags.map((tag) => {
          const count = data.articles.filter((article) => article.tagIds.includes(tag.id)).length;
          return (
            <form
              key={tag.id}
              className="filters"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void run(
                  () =>
                    adminSaveTag({
                      data: {
                        id: tag.id,
                        label: String(form.get("label") ?? ""),
                        slug: String(form.get("slug") ?? ""),
                      },
                    }),
                  "Tag saved.",
                );
              }}
            >
              <label className="field">
                <span>Label</span>
                <input name="label" defaultValue={tag.label} required />
              </label>
              <label className="field">
                <span>Slug</span>
                <input name="slug" defaultValue={tag.slug} />
              </label>
              <button className="btn" type="submit">
                Save
              </button>
              <button
                className="btn btn--ghost"
                type="button"
                onClick={() => {
                  if (count > 0) {
                    setError("Remove this tag from its articles before deleting it.");
                    return;
                  }
                  void run(() => adminDeleteTag({ data: { id: tag.id } }), "Tag deleted.");
                }}
              >
                Delete ({count})
              </button>
            </form>
          );
        })}
        <form
          className="filters"
          onSubmit={(event) => {
            event.preventDefault();
            const formEl = event.currentTarget;
            const form = new FormData(formEl);
            void run(async () => {
              await adminSaveTag({
                data: { id: null, label: String(form.get("label") ?? ""), slug: String(form.get("slug") ?? "") },
              });
              formEl.reset();
            }, "Tag created.");
          }}
        >
          <label className="field">
            <span>New tag</span>
            <input name="label" required />
          </label>
          <label className="field">
            <span>Slug</span>
            <input name="slug" />
          </label>
          <button className="btn" type="submit">
            Create tag
          </button>
        </form>
      </section>
    </>
  );
}
