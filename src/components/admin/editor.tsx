import { useEffect, useState } from "react";
import { Link, useBlocker, useNavigate, useRouter } from "@tanstack/react-router";
import { adminRestoreRevision, adminRevisions, adminSaveArticle, adminSetAiEditAllowed } from "@/content/admin-api";
import { DeleteArticleButton } from "./delete-article";
import { readingMinutes } from "@/content/present";
import type { Article, ArticleBlock, Category, CoverMotif, PublicationStatus, Tag } from "@/content/types";
import { slugify } from "@/content/validate";
import { errorText } from "./gate";
import { checklistScore, seoChecklist } from "@/lib/seo-checklist";

type MediaOption = { id: string; filename: string; alt: string };

type Draft = {
  id: string | null;
  title: string;
  slug: string;
  excerpt: string;
  categoryId: string;
  /** Extra topics beyond the main one (categoryId). Full set sent on save = [categoryId, ...topicIds]. */
  topicIds: string[];
  tagIds: string[];
  motif: CoverMotif;
  featured: boolean;
  seoTitle: string;
  seoDescription: string;
  coverMediaId: string | null;
  publishedAt: string;
  scheduledAt: string;
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
    topicIds: article.topicIds.filter((id) => id !== article.categoryId),
    tagIds: article.tagIds,
    motif: article.motif,
    featured: article.featured,
    seoTitle: article.seoTitle ?? "",
    seoDescription: article.seoDescription ?? "",
    coverMediaId: article.coverMediaId ?? null,
    publishedAt: toLocal(article.publishedAt),
    scheduledAt: toLocal(article.scheduledAt),
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
    topicIds: [],
    tagIds: [],
    motif: "corner",
    featured: false,
    seoTitle: "",
    seoDescription: "",
    coverMediaId: null,
    publishedAt: "",
    scheduledAt: "",
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
  const [aiEdit, setAiEdit] = useState(Boolean(article?.aiEditAllowed));
  const [aiEditBusy, setAiEditBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"publish" | "unpublish" | null>(null);
  const [revisions, setRevisions] = useState<Array<{ id: string; savedAt: string; title: string; status: string }>>([]);
  useEffect(() => {
    if (!article?.id) return;
    void adminRevisions({ data: { articleId: article.id } }).then(setRevisions).catch(() => undefined);
  }, [article?.id]);
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
          topicIds: [draft.categoryId, ...draft.topicIds.filter((id) => id !== draft.categoryId)],
          tagIds: draft.tagIds,
          motif: draft.motif,
          featured: draft.featured,
          seoTitle: draft.seoTitle,
          seoDescription: draft.seoDescription,
          coverMediaId: draft.coverMediaId,
          publishedAt: fromLocal(draft.publishedAt),
          scheduledAt: fromLocal(draft.scheduledAt),
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

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void commit("save");
      }}
    >
      <p className="desk-kicker">{draft.status}{aiEdit && draft.status === "published" ? " · AI edit allowed" : ""}</p>
      <h1 className="desk-title">{draft.title || "New article"}</h1>
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
            <span>Main topic</span>
            <select
              value={draft.categoryId}
              onChange={(event) => update({ categoryId: event.target.value, topicIds: draft.topicIds.filter((id) => id !== event.target.value) })}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="block-card">
            <legend>Also file under these topics (optional, up to 3 more)</legend>
            {categories
              .filter((category) => category.id !== draft.categoryId)
              .map((category) => (
                <label key={category.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={draft.topicIds.includes(category.id)}
                    disabled={!draft.topicIds.includes(category.id) && draft.topicIds.length >= 3}
                    onChange={(event) => {
                      update({
                        topicIds: event.target.checked
                          ? [...draft.topicIds, category.id]
                          : draft.topicIds.filter((id) => id !== category.id),
                      });
                    }}
                  />
                  {category.label}
                </label>
              ))}
            <p className="desk-note">An article can appear under several topics. The main topic is the one shown first on cards; the article is listed on every topic page it is filed under.</p>
          </fieldset>
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
            <span>Fallback pattern (only used when the cover style is set to Pattern)</span>
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
              <option value="">No image (use the site's fallback)</option>
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
          {draft.id ? (
            <fieldset className="block-card">
              <legend>AI editing (MCP)</legend>
              {draft.status === "published" ? (
                <>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={aiEdit}
                      disabled={aiEditBusy}
                      onChange={(event) => {
                        const next = event.target.checked;
                        setAiEdit(next);
                        setAiEditBusy(true);
                        void adminSetAiEditAllowed({ data: { id: draft.id as string, allowed: next } })
                          .then(() => { setMessage(next ? "AI may now edit this published article (it still cannot delete it or change its status)." : "AI edit grant removed."); })
                          .catch((caught: unknown) => { setAiEdit(!next); setError(errorText(caught)); })
                          .finally(() => setAiEditBusy(false));
                      }}
                    />
                    Allow AI to edit this article
                  </label>
                  <p className="desk-note">
                    Off by default: published articles are locked for AI. While on, an AI connected over MCP can revise this
                    one article's text, tags and cover — but it can never delete it, unpublish it, or change its slug or status.
                    Turn it off again when the revision is done.
                  </p>
                </>
              ) : (
                <p className="desk-note">
                  Drafts can be edited by the automation profile that created them (the master MCP token can edit any draft).
                  Published articles stay locked unless the grant above is switched on after publishing.
                </p>
              )}
            </fieldset>
          ) : null}
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
            <span className="field-help">{draft.seoTitle.trim().length}/60 characters</span>
          </label>
          <label className="field">
            <span>SEO description</span>
            <textarea value={draft.seoDescription} onChange={(event) => update({ seoDescription: event.target.value })} />
            <span className="field-help">{draft.seoDescription.trim().length}/160 characters</span>
          </label>
          {draft.status !== "published" ? (
            <label className="field">
              <span>Schedule publish (optional)</span>
              <input
                type="datetime-local"
                value={draft.scheduledAt}
                onChange={(event) => update({ scheduledAt: event.target.value })}
              />
              <span className="field-help">
                For drafts: the article goes live on the first site or admin visit after this time (there is no
                background timer). Clear the field to cancel the schedule.
              </span>
            </label>
          ) : null}
          <fieldset className="panel">
        <legend>History</legend>
        <p className="desk-note">
          The last 20 versions of this article, saved automatically before each change. Restoring brings back the
          text and settings of that version — it never changes publish status, and your current version is saved
          first, so a restore can itself be undone.
        </p>
        {revisions.length === 0 ? (
          <p className="desk-note">No earlier versions yet. The next save will create the first one.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.4rem" }}>
            {revisions.map((r) => (
              <li key={r.id} style={{ display: "flex", gap: "0.6rem", alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 200 }}>{r.title || "(untitled)"} <span className="desk-note">· was {r.status}</span></span>
                <span className="desk-note">{new Date(r.savedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
                <button
                  type="button" className="btn btn--ghost" disabled={Boolean(pending)}
                  onClick={() => {
                    if (!window.confirm("Restore this version? Your current version is saved to History first.")) return;
                    setPending("restore");
                    void adminRestoreRevision({ data: { revisionId: r.id } })
                      .then(async () => { setMessage("Version restored."); await router.invalidate(); })
                      .catch((caught: unknown) => setError(errorText(caught)))
                      .finally(() => setPending(null));
                  }}
                >Restore</button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <SeoChecklist draft={draft} />
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
              <p>Publish this article on the public site?</p>
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
                <p>Take this article off the public site? It becomes Unpublished and can be published again.</p>
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
          {draft.id ? (
            <DeleteArticleButton
              id={draft.id}
              title={draft.title || "Untitled"}
              status={draft.status}
              hasCover={Boolean(draft.coverMediaId)}
              onDeleted={async () => {
                setBaseline(JSON.stringify(draft));
                await navigate({ to: "/admin/articles" });
              }}
              label="Delete article"
            />
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

function SeoChecklist({ draft }: { draft: Draft }) {
  const words = draft.blocks
    .map((b) => (b.type === "list" ? b.items.join(" ") : b.type === "code" ? "" : b.text))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  const bodyStrings = draft.blocks.flatMap((b) => (b.type === "list" ? b.items : b.type === "code" ? [] : [b.text]));
  const linkCount = bodyStrings.reduce((n, s) => n + (s.match(/\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+/g) ?? []).length, 0);
  const items = seoChecklist({
    title: draft.title,
    seoTitle: draft.seoTitle,
    seoDescription: draft.seoDescription,
    excerpt: draft.excerpt,
    slug: draft.slug,
    coverMediaId: draft.coverMediaId,
    topicCount: 1 + draft.topicIds.filter((id) => id !== draft.categoryId).length,
    words,
    hasHeading: draft.blocks.some((b) => b.type === "heading"),
    linkCount,
    hasTakeawayOrTable: draft.blocks.some((b) => b.type === "heading" && /at a glance|key takeaways/i.test(b.text)),
    hasReaderActionHeading: draft.blocks.some((b) => b.type === "heading" && /what (this means|to do|.*means for you)|should you|how to (protect|fix|turn|stop)|what readers|what (you|users|developers) (can|should)/i.test(b.text)),
  });
  const score = checklistScore(items);
  return (
    <fieldset className="block-card">
      <legend>Before you publish ({score.passed}/{score.total})</legend>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.35rem" }}>
        {items.map((item) => (
          <li key={item.label}>
            <span aria-hidden="true">{item.ok ? "✓" : "○"}</span> {item.label}{" "}
            <span className="desk-note">— {item.hint}</span>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
