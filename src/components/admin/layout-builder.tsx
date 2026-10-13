import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  adminDiscardLayout,
  adminLayoutPreview,
  adminPublishLayout,
  adminSaveLayoutDraft,
} from "@/content/admin-api";
import { errorText } from "@/components/admin/gate";
import { HomeBlock, SidebarBlock } from "@/components/site/block-render";
import type { ResolvedBlock } from "@/content/layout.server";
import type { SiteConfig } from "@/content/types";
import { appearanceCss } from "@/lib/appearance";
import {
  AREA_TYPES,
  ARTICLE_SOURCE_LABELS,
  BLOCK_LIBRARY,
  LAYOUT_STYLES,
  SPACINGS,
  duplicateBlock,
  moveBlock,
  newBlock,
  summariseBlock,
  type Area,
  type Block,
  type LayoutDoc,
} from "@/lib/layout/blocks";

/**
 * The Homepage Builder and Sidebar Manager share this editor: a block library,
 * an ordered list you can reorder, edit, duplicate, hide or delete, a live
 * preview resolved from real published content, and Save draft / Publish.
 *
 * Nothing here writes straight to the public site: a draft is stored
 * separately and only Publish copies it over, so visitors never see an
 * unfinished arrangement.
 */

type Options = {
  articles: { slug: string; title: string; categoryLabel: string }[];
  categories: { id: string; slug: string; label: string }[];
  tags: { id: string; slug: string; label: string }[];
};

const AREA_TEXT: Record<Area, { kicker: string; title: string; intro: string; addLabel: string }> = {
  homepage: {
    kicker: "Site",
    title: "Homepage builder",
    intro:
      "Add blocks, put them in the order you want, and edit each one. Nothing changes on the public homepage until you press Publish.",
    addLabel: "Add a block",
  },
  sidebar: {
    kicker: "Site",
    title: "Sidebar manager",
    intro:
      "The sidebar beside an article. It is independent of the homepage: change it here without touching the homepage layout.",
    addLabel: "Add a sidebar block",
  },
};

export function LayoutBuilder({
  area,
  state,
  options,
  site,
}: {
  area: Area;
  state: { published: LayoutDoc; draft: LayoutDoc | null; derived: boolean; dirty: boolean };
  options: Options;
  site: SiteConfig;
}) {
  const router = useRouter();
  const [doc, setDoc] = useState<LayoutDoc>(state.draft ?? state.published);
  const [open, setOpen] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ blocks: ResolvedBlock[]; sample: { slug: string; title: string } | null } | null>(null);
  const [previewSlug, setPreviewSlug] = useState<string>(options.articles[0]?.slug ?? "");
  const [previewPending, setPreviewPending] = useState(false);

  const text = AREA_TEXT[area];
  const blocks = area === "homepage" ? doc.homepage.blocks : doc.sidebar.blocks;
  const types = AREA_TYPES[area];
  const publishedCount = area === "homepage" ? state.published.homepage.blocks.length : state.published.sidebar.blocks.length;

  const setBlocks = useCallback(
    (next: Block[]) => {
      setDoc((current) =>
        area === "homepage" ? { ...current, homepage: { blocks: next } } : { ...current, sidebar: { ...current.sidebar, blocks: next } },
      );
    },
    [area],
  );

  const run = async (key: string, work: () => Promise<unknown>, success: string) => {
    setPending(key);
    setError(null);
    setMessage(null);
    try {
      await work();
      setMessage(success);
      await router.invalidate();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(null);
    }
  };

  const refreshPreview = useCallback(async () => {
    setPreviewPending(true);
    setError(null);
    try {
      const result = await adminLayoutPreview({ data: { area, doc, articleSlug: previewSlug || undefined } });
      setPreview({ blocks: result.blocks as ResolvedBlock[], sample: result.sampleArticle });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPreviewPending(false);
    }
  }, [area, doc, previewSlug]);

  useEffect(() => {
    void refreshPreview();
    // Preview follows the draft; debounce keeps typing comfortable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(doc), previewSlug, area]);

  const dirty = useMemo(() => JSON.stringify(doc) !== JSON.stringify(state.published), [doc, state.published]);

  const update = (id: string, patch: Partial<Block>) => {
    setBlocks(blocks.map((block) => (block.id === id ? ({ ...block, ...patch } as Block) : block)));
  };

  const appearance = useMemo(() => appearanceCss(site.appearance), [site.appearance]);

  return (
    <>
      <p className="desk-kicker">{text.kicker}</p>
      <h1 className="desk-title">{text.title}</h1>
      <p className="desk-note">{text.intro}</p>

      <div className="builder-bar">
        <button type="button" className="btn" disabled={pending !== null} onClick={() => void run("save", () => adminSaveLayoutDraft({ data: { doc } }), "Draft saved. The public site still shows the published version.")}>
          {pending === "save" ? "Saving…" : "Save draft"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={pending !== null || !dirty}
          onClick={() => void run("publish", () => adminPublishLayout(), "Published. The live site now uses this arrangement.")}
        >
          {pending === "publish" ? "Publishing…" : "Publish"}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={pending !== null || state.draft === null}
          onClick={() => void run("discard", () => adminDiscardLayout(), "Draft discarded; the published layout is unchanged.")}
        >
          Discard draft
        </button>
        <span className={dirty ? "builder-state builder-state--dirty" : "builder-state"}>
          {dirty
            ? "Unpublished changes"
            : state.derived
              ? `Live layout derived from the old settings (${publishedCount} block${publishedCount === 1 ? "" : "s"})`
              : `Live: ${publishedCount} block${publishedCount === 1 ? "" : "s"}`}
        </span>
      </div>
      {error ? (
        <p className="banner banner--bad" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="banner banner--ok" role="status">
          {message}
        </p>
      ) : null}

      {area === "sidebar" ? (
        <fieldset className="block-card">
          <legend>Sidebar</legend>
          <label className="check-row">
            <input
              type="checkbox"
              checked={doc.sidebar.enabled}
              onChange={(event) => setDoc((current) => ({ ...current, sidebar: { ...current.sidebar, enabled: event.target.checked } }))}
            />
            Show the sidebar beside articles
          </label>
          <p className="field-help">When it is off, the article uses the full width. Blocks below are kept, not deleted.</p>
        </fieldset>
      ) : null}

      <div className="builder-layout">
        <section className="builder-list" aria-label={area === "homepage" ? "Homepage blocks" : "Sidebar blocks"}>
          {blocks.length === 0 ? (
            <p className="desk-note">No blocks yet. Add one from the library.</p>
          ) : (
            <ol className="builder-blocks">
              {blocks.map((block, index) => {
                const info = BLOCK_LIBRARY[block.type];
                const editing = open === block.id;
                return (
                  <li key={block.id} className={block.enabled ? "builder-block" : "builder-block is-off"}>
                    <div className="builder-block__head">
                      <button type="button" className="builder-block__toggle" aria-expanded={editing} onClick={() => setOpen(editing ? null : block.id)}>
                        <strong>{block.heading || info.name}</strong>
                        <span>{summariseBlock(block)}</span>
                      </button>
                      <div className="builder-block__actions">
                        <label className="check-row" title="Show or hide without deleting">
                          <input type="checkbox" checked={block.enabled} onChange={(event) => update(block.id, { enabled: event.target.checked } as Partial<Block>)} />
                          <span className="sr-only">Enabled</span>
                        </label>
                        <button type="button" className="btn btn--ghost btn--icon" aria-label="Move up" disabled={index === 0} onClick={() => setBlocks(moveBlock(blocks, block.id, -1))}>
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--icon"
                          aria-label="Move down"
                          disabled={index === blocks.length - 1}
                          onClick={() => setBlocks(moveBlock(blocks, block.id, 1))}
                        >
                          ↓
                        </button>
                        <button type="button" className="btn btn--ghost" onClick={() => setBlocks(duplicateBlock(blocks, block.id))}>
                          Duplicate
                        </button>
                        {confirmDelete === block.id ? (
                          <>
                            <button type="button" className="btn btn--danger" onClick={() => { setBlocks(blocks.filter((item) => item.id !== block.id)); setConfirmDelete(null); }}>
                              Delete block
                            </button>
                            <button type="button" className="btn btn--ghost" onClick={() => setConfirmDelete(null)}>
                              Keep
                            </button>
                          </>
                        ) : (
                          <button type="button" className="btn btn--danger-ghost" onClick={() => setConfirmDelete(block.id)}>
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                    {editing ? <BlockForm block={block} options={options} update={(patch) => update(block.id, patch)} /> : null}
                  </li>
                );
              })}
            </ol>
          )}

          <div className="builder-library">
            <button type="button" className="btn btn--ghost" aria-expanded={libraryOpen} onClick={() => setLibraryOpen((value) => !value)}>
              {libraryOpen ? "Close library" : text.addLabel}
            </button>
            {libraryOpen ? (
              <ul className="builder-library__list">
                {types.map((type) => (
                  <li key={type}>
                    <button
                      type="button"
                      className="builder-library__item"
                      onClick={() => {
                        const block = newBlock(type, area);
                        setBlocks([...blocks, block]);
                        setOpen(block.id);
                        setLibraryOpen(false);
                      }}
                    >
                      <strong>{BLOCK_LIBRARY[type].name}</strong>
                      <span>{BLOCK_LIBRARY[type].help}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>

        <section className="builder-preview" aria-label="Preview">
          <div className="builder-preview__bar">
            <h2>Preview</h2>
            {area === "sidebar" && options.articles.length > 0 ? (
              <label className="field field--inline">
                <span>Article</span>
                <select value={previewSlug} onChange={(event) => setPreviewSlug(event.target.value)}>
                  {options.articles.map((article) => (
                    <option key={article.slug} value={article.slug}>
                      {article.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button type="button" className="btn btn--ghost" disabled={previewPending} onClick={() => void refreshPreview()}>
              {previewPending ? "Rendering…" : "Refresh"}
            </button>
          </div>
          <p className="field-help">
            {preview?.sample ? `Content from the live site${area === "sidebar" ? ` · sample article “${preview.sample.title}”` : ""}.` : "Real published articles, resolved from your draft."}
          </p>
          <div className={area === "sidebar" ? "preview-frame preview-frame--aside" : "preview-frame"}>
            <style dangerouslySetInnerHTML={{ __html: appearance }} />
            <div className="preview-page" data-theme="light">
              {preview ? (
                preview.blocks.length === 0 ? (
                  <p className="lede">Nothing would render yet — blocks are hidden, empty, or off.</p>
                ) : area === "homepage" ? (
                  preview.blocks.map((block) => <HomeBlock key={block.block.id} resolved={block} site={site} />)
                ) : (
                  <aside className="article-aside">
                    {preview.blocks.map((block) => (
                      <SidebarBlock key={block.block.id} resolved={block} site={site} />
                    ))}
                  </aside>
                )
              ) : (
                <p className="lede">Rendering…</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function BlockForm({ block, options, update }: { block: Block; options: Options; update: (patch: Partial<Block>) => void }) {
  const field = (label: string, control: React.ReactNode, help?: string) => (
    <label className="field">
      <span>{label}</span>
      {control}
      {help ? <small>{help}</small> : null}
    </label>
  );

  const check = (label: string, checked: boolean, onChange: (value: boolean) => void) => (
    <label className="check-row">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );

  const headingFields = (
    <div className="filters">
      {field("Heading", <input value={block.heading} maxLength={80} onChange={(event) => update({ heading: event.target.value } as Partial<Block>)} />)}
      {field(
        "Intro line (optional)",
        <input value={block.description} maxLength={240} onChange={(event) => update({ description: event.target.value } as Partial<Block>)} />,
      )}
      {field(
        "Spacing",
        <select value={block.spacing} onChange={(event) => update({ spacing: event.target.value as Block["spacing"] } as Partial<Block>)}>
          {SPACINGS.map((value) => (
            <option key={value} value={value}>
              {value === "compact" ? "Compact" : value === "roomy" ? "Roomy" : "Normal"}
            </option>
          ))}
        </select>,
      )}
    </div>
  );

  return (
    <div className="builder-form">
      {block.type === "hero" ? (
        <>
          <div className="filters">
            {field("Kicker (small line above the title)", <input value={block.kicker} maxLength={40} onChange={(event) => update({ kicker: event.target.value } as Partial<Block>)} />)}
          </div>
          {check("Show the excerpt", block.showExcerpt, (value) => update({ showExcerpt: value } as Partial<Block>))}
          {check("Show the cover image", block.showCover, (value) => update({ showCover: value } as Partial<Block>))}
          <p className="field-help">The hero shows the article marked Featured, or the newest one when nothing is featured.</p>
        </>
      ) : null}

      {block.type === "articleList" ? (
        <>
          <div className="filters">
            {field(
              "Where the articles come from",
              <select value={block.source} onChange={(event) => update({ source: event.target.value as never } as Partial<Block>)}>
                {Object.entries(ARTICLE_SOURCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>,
            )}
            {field("How many", <input type="number" min={1} max={48} value={block.count} onChange={(event) => update({ count: Number(event.target.value) } as Partial<Block>)} />)}
            {field(
              "Layout",
              <select value={block.style} onChange={(event) => update({ style: event.target.value as never } as Partial<Block>)}>
                {LAYOUT_STYLES.map((value) => (
                  <option key={value} value={value}>
                    {value === "index" ? "Numbered index" : value === "grid" ? "Cards grid" : "Simple list"}
                  </option>
                ))}
              </select>,
            )}
            {block.style === "grid"
              ? field("Columns", <input type="number" min={1} max={4} value={block.columns} onChange={(event) => update({ columns: Number(event.target.value) } as Partial<Block>)} />)
              : null}
          </div>
          <div className="filters">
            {check("Show images", block.showImages, (value) => update({ showImages: value } as Partial<Block>))}
            {check("Show the excerpt", block.showExcerpt, (value) => update({ showExcerpt: value } as Partial<Block>))}
            {check("Show topic and date", block.showMeta, (value) => update({ showMeta: value } as Partial<Block>))}
            {check(
              "Show the heading even when empty",
              block.empty === "message",
              (value) => update({ empty: value ? "message" : "hide" } as Partial<Block>),
            )}
          </div>
          {block.source === "category" ? (
            <fieldset className="builder-sub">
              <legend>Topics</legend>
              {options.categories.length === 0 ? <p className="field-help">No topics yet.</p> : null}
              {options.categories.map((category) => (
                <label key={category.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={block.categoryIds.includes(category.id)}
                    onChange={(event) =>
                      update({
                        categoryIds: event.target.checked ? [...block.categoryIds, category.id] : block.categoryIds.filter((id) => id !== category.id),
                      } as Partial<Block>)
                    }
                  />
                  {category.label}
                </label>
              ))}
            </fieldset>
          ) : null}
          {block.source === "tag" ? (
            <fieldset className="builder-sub">
              <legend>Tags</legend>
              {options.tags.length === 0 ? <p className="field-help">No tags yet.</p> : null}
              {options.tags.map((tag) => (
                <label key={tag.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={block.tagIds.includes(tag.id)}
                    onChange={(event) => update({ tagIds: event.target.checked ? [...block.tagIds, tag.id] : block.tagIds.filter((id) => id !== tag.id) } as Partial<Block>)}
                  />
                  {tag.label}
                </label>
              ))}
            </fieldset>
          ) : null}
          {block.source === "manual" ? (
            <fieldset className="builder-sub">
              <legend>Picked articles (in this order)</legend>
              <ol className="builder-picked">
                {block.slugs.map((slug, index) => {
                  const article = options.articles.find((item) => item.slug === slug);
                  return (
                    <li key={slug}>
                      <span>{article?.title ?? slug}</span>
                      <button type="button" className="btn btn--ghost btn--icon" aria-label="Move up" disabled={index === 0} onClick={() => update({ slugs: moveBlock(block.slugs.map((value) => ({ id: value })), slug, -1).map((item) => item.id) } as Partial<Block>)}>
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--icon"
                        aria-label="Move down"
                        disabled={index === block.slugs.length - 1}
                        onClick={() => update({ slugs: moveBlock(block.slugs.map((value) => ({ id: value })), slug, 1).map((item) => item.id) } as Partial<Block>)}
                      >
                        ↓
                      </button>
                      <button type="button" className="btn btn--danger-ghost" onClick={() => update({ slugs: block.slugs.filter((value) => value !== slug) } as Partial<Block>)}>
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ol>
              {options.articles.filter((article) => !block.slugs.includes(article.slug)).length > 0 ? (
                <label className="field">
                  <span>Add an article</span>
                  <select
                    value=""
                    onChange={(event) => {
                      if (event.target.value) update({ slugs: [...block.slugs, event.target.value] } as Partial<Block>);
                    }}
                  >
                    <option value="">Choose a published article…</option>
                    {options.articles
                      .filter((article) => !block.slugs.includes(article.slug))
                      .map((article) => (
                        <option key={article.slug} value={article.slug}>
                          {article.title}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
            </fieldset>
          ) : null}
          {block.source === "related" ? <p className="field-help">Resolved from the article being read (same topic, then shared tags). Sidebar only.</p> : null}
        </>
      ) : null}

      {block.type === "categories" ? (
        <div className="filters">
          {field("How many", <input type="number" min={1} max={30} value={block.count} onChange={(event) => update({ count: Number(event.target.value) } as Partial<Block>)} />)}
          {field(
            "Style",
            <select value={block.style} onChange={(event) => update({ style: event.target.value as never } as Partial<Block>)}>
              <option value="cards">Cards</option>
              <option value="list">Simple list</option>
            </select>,
          )}
          {check("Show article counts", block.showCounts, (value) => update({ showCounts: value } as Partial<Block>))}
        </div>
      ) : null}

      {block.type === "tags" ? (
        <div className="filters">
          {field("How many", <input type="number" min={1} max={40} value={block.count} onChange={(event) => update({ count: Number(event.target.value) } as Partial<Block>)} />)}
          <p className="field-help">Only tags used by published articles appear.</p>
        </div>
      ) : null}

      {block.type === "richText" ? (
        <label className="field">
          <span>Text (blank line between paragraphs)</span>
          <textarea value={block.body} maxLength={4000} onChange={(event) => update({ body: event.target.value } as Partial<Block>)} />
        </label>
      ) : null}

      {block.type === "announcement" ? (
        <div className="filters">
          {field(
            "Tone",
            <select value={block.tone} onChange={(event) => update({ tone: event.target.value as never } as Partial<Block>)}>
              <option value="accent">Accent (coloured)</option>
              <option value="plain">Plain</option>
            </select>,
          )}
          {field("Link label", <input value={block.linkLabel} maxLength={40} onChange={(event) => update({ linkLabel: event.target.value } as Partial<Block>)} />)}
          {field("Link", <input value={block.href} maxLength={300} onChange={(event) => update({ href: event.target.value } as Partial<Block>)} />, "A site path like /about, or an https URL.")}
        </div>
      ) : null}

      {headingFields}

      <fieldset className="builder-sub">
        <legend>“View all” link (optional)</legend>
        <div className="filters">
          {field(
            "Label",
            <input
              value={block.viewAll?.label ?? ""}
              maxLength={40}
              onChange={(event) => update({ viewAll: event.target.value ? { label: event.target.value, href: block.viewAll?.href ?? "/articles" } : null } as Partial<Block>)}
            />,
          )}
          {field(
            "Link",
            <input value={block.viewAll?.href ?? ""} maxLength={300} onChange={(event) => update({ viewAll: { label: block.viewAll?.label ?? "View all", href: event.target.value } } as Partial<Block>)} />,
            "A site path like /articles, or an https URL.",
          )}
        </div>
      </fieldset>
    </div>
  );
}
