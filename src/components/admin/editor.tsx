import { useState } from "react";
import { Link, useBlocker, useNavigate, useRouter } from "@tanstack/react-router";
import { adminDeleteDraft, adminSaveArticle } from "@/content/admin-api";
import { readingMinutes } from "@/content/present";
import type { Article, ArticleBlock, Category, CoverMotif, PublicationStatus, Tag } from "@/content/types";
import { slugify } from "@/content/validate";
import { errorText } from "./gate";

type MediaOption = { id: string; filename: string; alt: string };

type Draft = {
  id: string | null;
  title: string;
  slug: string;
  excerpt: string;
  categoryId: string;
  tagIds: string[];
  motif: CoverMotif;
  featured: boolean;
  seoTitle: string;
  seoDescription: string;
  coverMediaId: string | null;
  publishedAt: string;
  blocks: ArticleBlock[];
  status: PublicationStatus;
};

const motifs: CoverMotif[] = ["corner", "band", "split", "stamp", "stack", "edge"];

function toLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function fromArticle(article: Article): Draft {
  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    excerpt: article.excerpt,
    categoryId: article.categoryId,
    tagIds: article.tagIds,
    motif: article.motif,
    featured: article.featured,
    seoTitle: article.seoTitle ?? "",
    seoDescription: article.seoDescription ?? "",
    coverMediaId: article.coverMediaId ?? null,
    publishedAt: toLocal(article.publishedAt),
    blocks: article.blocks,
    status: article.status,
  };
}

function blank(categoryId: string): Draft {
  return {
    id: null,
    title: "",
    slug: "",
    excerpt: "",
    categoryId,
    tagIds: [],
    motif: "corner",
    featured: false,
    seoTitle: "",
    seoDescription: "",
    coverMediaId: null,
    publishedAt: "",
    blocks: [{ type: "paragraph", text: "" }],
    status: "draft",
  };
}

export function ArticleEditor({
  article,
  categories,
  tags,
  media,
}: {
  article: Article | null;
  categories: Category[];
  tags: Tag[];
  media: MediaOption[];
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => (article ? fromArticle(article) : blank(categories[0]?.id ?? "")));
  const [baseline, setBaseline] = useState(() => JSON.stringify(article ? fromArticle(article) : blank(categories[0]?.id ?? "")));
  const [slugTouched, setSlugTouched] = useState(Boolean(article));
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"publish" | "unpublish" | "delete" | null>(null);
  const dirty = JSON.stringify(draft) !== baseline;
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !pending,
    enableBeforeUnload: () => dirty && !pending,
    withResolver: true,
  });

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function setTitle(title: string) {
    setDraft((current) => ({
      ...current,
      title,
      slug: slugTouched ? current.slug : slugify(title),
    }));
  }

  function setBlock(index: number, block: ArticleBlock) {
    setDraft((current) => ({
      ...current,
      blocks: current.blocks.map((item, itemIndex) => (itemIndex === index ? block : item)),
    }));
  }

  function moveBlock(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const next = [...current.blocks];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      const [item] = next.splice(index, 1);
      if (!item) return current;
      next.splice(target, 0, item);
      return { ...current, blocks: next };
    });
  }

  async function commit(intent: "save" | "publish" | "unpublish") {
    setPending(intent);
    setError(null);
    setMessage(null);
    try {
      const saved = await adminSaveArticle({
        data: {
          id: draft.id,
          title: draft.title,
          slug: draft.slug,
          excerpt: draft.excerpt,
          categoryId: draft.categoryId,
          tagIds: draft.tagIds,
          motif: draft.motif,
          featured: draft.featured,
          seoTitle: draft.seoTitle,
          seoDescription: draft.seoDescription,
          coverMediaId: draft.coverMediaId,
          publishedAt: fromLocal(draft.publishedAt),
          blocks: draft.blocks,
          intent,
        },
      });
      const next = {
        ...draft,
        id: saved.id,
        slug: saved.slug,
        status: saved.status,
      };
      setDraft(next);
      setBaseline(JSON.stringify(next));
      setSlugTouched(true);
      setConfirm(null);
      setMessage(intent === "publish" ? "Published." : intent === "unpublish" ? "Unpublished." : "Saved.");
      if (!draft.id) {
        await navigate({ to: "/admin/articles/$id", params: { id: saved.id } });
      }
      await router.invalidate();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(null);
    }
  }

  async function removeDraft() {
    if (!draft.id) return;
    setPending("delete");
    setError(null);
    try {
      await adminDeleteDraft({ data: { id: draft.id } });
      setBaseline(JSON.stringify(draft));
      await navigate({ to: "/admin/articles" });
    } catch (caught) {
      setError(errorText(caught));
      setPending(null);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void commit("save");
      }}
    >
      <p className="desk-kicker">{draft.status}</p>
      <h1 className="desk-title">{draft.title || "New piece"}</h1>
      <p className="desk-note">
        {readingMinutes({ blocks: draft.blocks })} min · the public page uses this same article shape.
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
      {blocker.status === "blocked" ? (
        <div className="banner" role="alert">
          <p>Leave without saving?</p>
          <div className="inline-actions">
            <button type="button" className="btn" onClick={() => blocker.proceed()}>
              Leave
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => blocker.reset()}>
              Stay
            </button>
          </div>
        </div>
      ) : null}
      <div className="editor-grid">
        <div className="stack">
          <label className="field">
            <span>Title</span>
            <input value={draft.title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label className="field">
            <span>Excerpt</span>
            <textarea value={draft.excerpt} onChange={(event) => update({ excerpt: event.target.value })} />
          </label>
          {draft.blocks.map((block, index) => (
            <fieldset key={index} className="block-card">
              <legend>
                Block {index + 1} · {block.type}
              </legend>
              <BlockFields block={block} onChange={(next) => setBlock(index, next)} />
              <div className="inline-actions">
                <button type="button" className="btn btn--ghost" onClick={() => moveBlock(index, -1)} disabled={index === 0}>
                  Move up
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => moveBlock(index, 1)}
                  disabled={index === draft.blocks.length - 1}
                >
                  Move down
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() =>
                    update({ blocks: draft.blocks.filter((_, blockIndex) => blockIndex !== index) })
                  }
                >
                  Remove
                </button>
              </div>
            </fieldset>
          ))}
          <label className="field">
            <span>Add a block</span>
            <select
              value=""
              onChange={(event) => {
                const type = event.target.value;
                if (!type) return;
                update({ blocks: [...draft.blocks, emptyBlock(type)] });
              }}
            >
              <option value="">Choose</option>
              <option value="paragraph">Paragraph</option>
              <option value="heading">Heading</option>
              <option value="list">List</option>
              <option value="quote">Quote</option>
              <option value="code">Code</option>
            </select>
          </label>
        </div>
        <div className="stack">
          <label className="field">
            <span>Slug</span>
            <input
              value={draft.slug}
              onChange={(event) => {
                setSlugTouched(true);
                update({ slug: event.target.value });
              }}
            />
          </label>
          <label className="field">
            <span>Topic</span>
            <select value={draft.categoryId} onChange={(event) => update({ categoryId: event.target.value })}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="block-card">
            <legend>Tags</legend>
            {tags.map((tag) => (
              <label key={tag.id} className="check-row">
                <input
                  type="checkbox"
                  checked={draft.tagIds.includes(tag.id)}
                  onChange={(event) => {
                    update({
                      tagIds: event.target.checked
                        ? [...draft.tagIds, tag.id]
                        : draft.tagIds.filter((id) => id !== tag.id),
                    });
                  }}
                />
                {tag.label}
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>Plate</span>
            <select value={draft.motif} onChange={(event) => update({ motif: event.target.value as CoverMotif })}>
              {motifs.map((motif) => (
                <option key={motif} value={motif}>
                  {motif}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Cover image</span>
            <select
              value={draft.coverMediaId ?? ""}
              onChange={(event) => update({ coverMediaId: event.target.value || null })}
            >
              <option value="">Geometric plate</option>
              {media.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.filename}
                </option>
              ))}
            </select>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={draft.featured}
              onChange={(event) => update({ featured: event.target.checked })}
            />
            Featured on the homepage
          </label>
          <label className="field">
            <span>Publication date</span>
            <input
              type="datetime-local"
              value={draft.publishedAt}
              onChange={(event) => update({ publishedAt: event.target.value })}
            />
          </label>
          <label className="field">
            <span>SEO title</span>
            <input value={draft.seoTitle} onChange={(event) => update({ seoTitle: event.target.value })} />
          </label>
          <label className="field">
            <span>SEO description</span>
            <textarea value={draft.seoDescription} onChange={(event) => update({ seoDescription: event.target.value })} />
          </label>
          <div className="inline-actions">
            <button className="btn" type="submit" disabled={Boolean(pending)}>
              {pending === "save" ? "Saving…" : "Save"}
            </button>
            {draft.id ? (
              <Link to="/preview/$id" params={{ id: draft.id }} className="btn btn--ghost">
                Preview
              </Link>
            ) : (
              <span className="desk-note">Save once to preview.</span>
            )}
          </div>
          {confirm === "publish" ? (
            <div className="banner">
              <p>Publish this piece to the public journal?</p>
              <div className="inline-actions">
                <button type="button" className="btn" disabled={Boolean(pending)} onClick={() => void commit("publish")}>
                  {pending === "publish" ? "Publishing…" : "Publish"}
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setConfirm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn" onClick={() => setConfirm("publish")}>
              Publish
            </button>
          )}
          {draft.status === "published" ? (
            confirm === "unpublish" ? (
              <div className="banner">
                <p>Take this piece off the public journal?</p>
                <div className="inline-actions">
                  <button type="button" className="btn" disabled={Boolean(pending)} onClick={() => void commit("unpublish")}>
                    Unpublish
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn--ghost" onClick={() => setConfirm("unpublish")}>
                Unpublish
              </button>
            )
          ) : null}
          {draft.id && draft.status !== "published" ? (
            confirm === "delete" ? (
              <div className="banner banner--bad">
                <p>Delete this {draft.status} piece? This cannot be undone.</p>
                <div className="inline-actions">
                  <button type="button" className="btn" disabled={Boolean(pending)} onClick={() => void removeDraft()}>
                    {pending === "delete" ? "Deleting…" : "Delete"}
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn--ghost" onClick={() => setConfirm("delete")}>
                Delete
              </button>
            )
          ) : null}
        </div>
      </div>
    </form>
  );
}

function emptyBlock(type: string): ArticleBlock {
  if (type === "heading") return { type: "heading", level: 2, text: "" };
  if (type === "list") return { type: "list", items: [""] };
  if (type === "quote") return { type: "quote", text: "" };
  if (type === "code") return { type: "code", code: "" };
  return { type: "paragraph", text: "" };
}

function BlockFields({ block, onChange }: { block: ArticleBlock; onChange: (block: ArticleBlock) => void }) {
  if (block.type === "heading") {
    return (
      <>
        <label className="field">
          <span>Level</span>
          <select
            value={block.level}
            onChange={(event) => onChange({ ...block, level: Number(event.target.value) === 3 ? 3 : 2 })}
          >
            <option value={2}>Heading 2</option>
            <option value={3}>Heading 3</option>
          </select>
        </label>
        <label className="field">
          <span>Text</span>
          <input value={block.text} onChange={(event) => onChange({ ...block, text: event.target.value })} />
        </label>
      </>
    );
  }
  if (block.type === "list") {
    return (
      <>
        <label className="check-row">
          <input
            type="checkbox"
            checked={Boolean(block.ordered)}
            onChange={(event) => onChange({ ...block, ordered: event.target.checked })}
          />
          Numbered
        </label>
        <label className="field">
          <span>Items, one per line</span>
          <textarea
            value={block.items.join("\n")}
            onChange={(event) => onChange({ ...block, items: event.target.value.split("\n") })}
          />
        </label>
      </>
    );
  }
  if (block.type === "quote") {
    return (
      <>
        <label className="field">
          <span>Quote</span>
          <textarea value={block.text} onChange={(event) => onChange({ ...block, text: event.target.value })} />
        </label>
        <label className="field">
          <span>Attribution</span>
          <input
            value={block.attribution ?? ""}
            onChange={(event) => onChange({ ...block, attribution: event.target.value })}
          />
        </label>
      </>
    );
  }
  if (block.type === "code") {
    return (
      <>
        <label className="field">
          <span>Language</span>
          <input
            value={block.language ?? ""}
            onChange={(event) => onChange({ ...block, language: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Code</span>
          <textarea value={block.code} onChange={(event) => onChange({ ...block, code: event.target.value })} />
        </label>
      </>
    );
  }
  return (
    <label className="field">
      <span>Paragraph</span>
      <textarea value={block.text} onChange={(event) => onChange({ ...block, text: event.target.value })} />
    </label>
  );
}
