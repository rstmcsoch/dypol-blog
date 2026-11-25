import "@/styles-content-admin.css";
import { useState } from "react";
import { adminPending } from "@/components/admin/pending";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import { SettingsTabs, type SettingsTab } from "@/components/admin/settings-tabs";
import { tabPanelProps } from "@/lib/admin-tabs";
import {
  adminDeleteCategory,
  adminDeleteTag,
  adminSaveCategory,
  adminSaveTag,
  adminTaxonomy,
} from "@/content/admin-api";

export const Route = createFileRoute("/admin/topics")({
  ...adminPending,
  loader: () => adminTaxonomy(),
  component: TopicsDesk,
});

const P = "taxonomy";

function TopicsDesk() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [tab, setTab] = useState<string>("topics");
  const [topicQuery, setTopicQuery] = useState("");
  const [tagQuery, setTagQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const tabs: SettingsTab[] = [
    { id: "topics", label: `Topics (${data.categories.length})` },
    { id: "tags", label: `Tags (${data.tags.length})` },
  ];

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

  const tq = topicQuery.trim().toLowerCase();
  const filteredCategories = tq
    ? data.categories.filter((c) => c.label.toLowerCase().includes(tq) || c.slug.toLowerCase().includes(tq))
    : data.categories;

  const gq = tagQuery.trim().toLowerCase();
  const filteredTags = gq
    ? data.tags.filter((t) => t.label.toLowerCase().includes(gq) || t.slug.toLowerCase().includes(gq))
    : data.tags;

  return (
    <>
      <p className="desk-kicker">Taxonomy</p>
      <h1 className="desk-title">Topics and tags</h1>
      <p className="desk-note">
        AI articles are filed under 1–4 topics by content. Renaming a topic updates it everywhere; topics or tags still used by articles cannot be deleted.
      </p>

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

      <SettingsTabs tabs={tabs} active={tab} onChange={setTab} label="Taxonomy sections" idPrefix={P} />

      <div {...tabPanelProps(P, "topics", tab)} className="tax-stack">
        <form
          className="tax-create"
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
          <div className="tax-create__head">
            <h2 className="tax-create__title">New topic</h2>
            <button className="btn btn--primary btn--sm" type="submit">
              + Create topic
            </button>
          </div>
          <div className="tax-create__row">
            <label className="field">
              <span>Label *</span>
              <input name="label" placeholder="e.g. Cybersecurity" required />
            </label>
            <label className="field">
              <span>Slug (optional)</span>
              <input name="slug" placeholder="cybersecurity" />
            </label>
          </div>
          <label className="field">
            <span>Description</span>
            <textarea name="description" rows={2} placeholder="Short topic description…" />
          </label>
        </form>

        <div className="tax-filter">
          <input
            type="search"
            value={topicQuery}
            onChange={(e) => setTopicQuery(e.target.value)}
            placeholder="Filter topics by name or slug…"
            aria-label="Filter topics"
          />
          {tq ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setTopicQuery("")}>
              Clear
            </button>
          ) : (
            <span className="ca-pill">{filteredCategories.length} topics</span>
          )}
        </div>

        <div className="tax-grid">
          {filteredCategories.map((category) => {
            const count = data.articles.filter((article) => (article.topicIds ?? [article.categoryId]).includes(category.id)).length;
            return (
              <form
                key={category.id}
                className="tax-card"
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
                <div className="tax-card__head">
                  <div className="tax-card__title">
                    <strong>{category.label}</strong>
                    <span className="ca-pill">{count} {count === 1 ? "article" : "articles"}</span>
                  </div>
                  <div className="tax-card__actions">
                    <button className="btn btn--primary btn--sm" type="submit">
                      Save
                    </button>
                    <button
                      className="btn btn--danger-ghost btn--sm"
                      type="button"
                      onClick={() => {
                        if (count > 0) {
                          setError("Move the articles in this topic to another topic before deleting it.");
                          return;
                        }
                        void run(() => adminDeleteCategory({ data: { id: category.id } }), "Topic deleted.");
                      }}
                    >
                      Delete ({count})
                    </button>
                  </div>
                </div>
                <div className="tax-card__fields">
                  <label className="field">
                    <span>Label</span>
                    <input name="label" defaultValue={category.label} required />
                  </label>
                  <label className="field">
                    <span>Slug</span>
                    <input name="slug" defaultValue={category.slug} />
                  </label>
                </div>
                <label className="field">
                  <span>Description</span>
                  <textarea name="description" rows={2} defaultValue={category.description} />
                </label>
              </form>
            );
          })}
        </div>
      </div>

      <div {...tabPanelProps(P, "tags", tab)} className="tax-stack">
        <form
          className="tax-create"
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
          <div className="tax-create__tagrow">
            <label className="field">
              <span>New tag *</span>
              <input name="label" placeholder="e.g. OpenAI" required />
            </label>
            <label className="field">
              <span>Slug (optional)</span>
              <input name="slug" placeholder="openai" />
            </label>
            <button className="btn btn--primary btn--sm" type="submit">
              + Create tag
            </button>
          </div>
        </form>

        <div className="tax-filter">
          <input
            type="search"
            value={tagQuery}
            onChange={(e) => setTagQuery(e.target.value)}
            placeholder="Filter tags by name or slug…"
            aria-label="Filter tags"
          />
          {gq ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setTagQuery("")}>
              Clear
            </button>
          ) : (
            <span className="ca-pill">{filteredTags.length} tags</span>
          )}
        </div>

        <div className="tax-tag-list">
          {filteredTags.map((tag) => {
            const count = data.articles.filter((article) => article.tagIds.includes(tag.id)).length;
            return (
              <form
                key={tag.id}
                className="tax-tag-row"
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
                <span className="ca-pill tax-tag-row__count">{count} {count === 1 ? "article" : "articles"}</span>
                <div className="adm-row-actions">
                  <button className="btn btn--primary btn--sm" type="submit">
                    Save
                  </button>
                  <button
                    className="btn btn--danger-ghost btn--sm"
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
                </div>
              </form>
            );
          })}
        </div>
      </div>
    </>
  );
}
