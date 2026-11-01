import { useState } from "react";
import { move } from "@/components/admin/site-form";
import type { BlockType, ContentBlock } from "@/content/types";
import { block as makeBlock } from "@/content/site";
import { ShareButtonsEditor } from "@/components/admin/share-editor";
import type { ShareSettings } from "@/lib/share-buttons";

export const BLOCK_INFO: Record<BlockType, { name: string; help: string; count?: string; layout?: boolean }> = {
  featured: { name: "Featured article (hero)", help: "The article marked Featured, or the newest one, shown big." },
  also: { name: "Also filed (coloured band)", help: "The next few stories after the featured one.", count: "Stories" },
  latest: { name: "Latest articles", help: "Newest stories (continues after the coloured band).", count: "Stories", layout: true },
  related: { name: "You may also like (related)", help: "Stories that share a topic or tags with the featured article (or, in the sidebar, the article being read).", count: "Stories", layout: true },
  popular: { name: "Most read", help: "Stories with the most views (counted anonymously on this site). Hidden until there are views.", count: "Stories", layout: true },
  category: { name: "Topic block", help: "Stories from one topic. Add as many as you like.", count: "Stories", layout: true },
  tag: { name: "Tag block", help: "Stories with one tag.", count: "Stories", layout: true },
  topics: { name: "Topics grid", help: "Cards for your topics with article counts.", count: "Topics" },
  ticker: { name: "News list (from the top strip settings)", help: "The top strip's items as a list inside the page.", count: "Items" },
  text: { name: "Text", help: "Your own text. Simple formatting: ## heading, **bold**, - lists, [link](https://…). No HTML." },
  cta: { name: "Button / newsletter call-to-action", help: "A box with a short text and one button (e.g. “Subscribe” linking to your newsletter page)." },
  tags: { name: "Tags of this article", help: "The article's tags." },
  newStories: { name: "New stories", help: "The newest other articles.", count: "Stories" },
  share: { name: "Share buttons", help: "Buttons to share the article. Choose, order and rename them below (WhatsApp, Telegram, Reddit, custom links and more)." },
  river: { name: "Latest river + Most read", help: "Newest stories not shown above, with dates, beside a numbered Most-read rail (the rail appears once stories have views).", count: "Stories" },
  topicRows: { name: "Topic rows (automatic)", help: "One row for each of your busiest topics: a big story, three small ones and a “More in …” button. A topic needs at least 3 stories not shown above.", count: "Topics" },
  quickReads: { name: "Quick reads", help: "The shortest stories not shown above, with their reading time.", count: "Stories" },
  moreStories: { name: "More stories", help: "Everything not shown above as a grid, with a button to the full index. Put it near the end.", count: "Stories", layout: true },
};

type Option = { id: string; label: string };

/**
 * Add / remove / reorder / edit blocks. Reorder with the arrow buttons or by
 * dragging the handle. Used for the homepage and the article sidebar.
 */
export function BlockEditor({
  blocks,
  onChange,
  types,
  categories,
  tags,
  defaultTitle,
  prefix,
  share,
  onShareChange,
}: {
  blocks: ContentBlock[];
  onChange: (next: ContentBlock[]) => void;
  types: readonly BlockType[];
  categories: Option[];
  tags: Option[];
  defaultTitle: (b: ContentBlock) => string;
  prefix: string;
  /** t148: share-button settings, edited inside the Share block (sidebar only). */
  share?: ShareSettings;
  onShareChange?: (next: ShareSettings) => void;
}) {
  const [adding, setAdding] = useState<BlockType>(types.find((t) => t === "category") ?? types[0]);
  const [drag, setDrag] = useState<number | null>(null);
  const update = (i: number, next: Partial<ContentBlock>) => onChange(blocks.map((b, j) => (j === i ? { ...b, ...next } : b)));
  const add = () => {
    const id = `${prefix}-${adding}-${Math.random().toString(36).slice(2, 8)}`;
    onChange([
      ...blocks,
      makeBlock(id, adding, {
        categoryId: adding === "category" ? (categories[0]?.id ?? "") : "",
        tagId: adding === "tag" ? (tags[0]?.id ?? "") : "",
        ctaLabel: adding === "cta" ? "Subscribe" : "",
        ctaHref: adding === "cta" ? "/about" : "",
        body: adding === "text" ? "Write something here." : "",
        count: adding === "featured" ? 1 : 5,
      }),
    ]);
  };
  return (
    <div className="stack" data-testid={`${prefix}-blocks`}>
      {blocks.length === 0 ? <p className="field-help">No blocks yet. Add one below.</p> : null}
      {blocks.map((b, i) => {
        const info = BLOCK_INFO[b.type];
        return (
          <div
            key={b.id}
            className={drag === i ? "block-card adm-block is-dragging" : "block-card adm-block"}
            data-block={b.type}
            onDragOver={(e) => {
              if (drag === null) return;
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag === null || drag === i) return;
              const next = [...blocks];
              const [item] = next.splice(drag, 1);
              next.splice(i, 0, item as ContentBlock);
              onChange(next);
              setDrag(null);
            }}
          >
            <div className="filters" style={{ alignItems: "center" }}>
              <span className="adm-drag" draggable onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)} title="Drag to reorder" aria-hidden="true">
                ⋮⋮
              </span>
              <label className="check-row" style={{ flex: 1 }}>
                <input type="checkbox" checked={b.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
                <strong>{info.name}</strong>
                {b.enabled ? null : <span className="adm-muted"> (hidden)</span>}
              </label>
              <div className="adm-row-actions">
                <button type="button" className="btn btn--ghost" aria-label={`Move ${info.name} up`} disabled={i === 0} onClick={() => onChange(move(blocks, i, -1))}>
                  ↑
                </button>
                <button type="button" className="btn btn--ghost" aria-label={`Move ${info.name} down`} disabled={i === blocks.length - 1} onClick={() => onChange(move(blocks, i, 1))}>
                  ↓
                </button>
                <button type="button" className="btn btn--danger" aria-label={`Remove ${info.name}`} onClick={() => onChange(blocks.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            </div>
            <p className="field-help">{info.help}</p>
            <div className="filters">
              {b.type !== "share" || prefix === "side" ? (
                <label className="field">
                  <span>Heading</span>
                  <input value={b.title} placeholder={defaultTitle(b) || "(no heading)"} maxLength={120} onChange={(e) => update(i, { title: e.target.value })} />
                </label>
              ) : null}
              {info.count ? (
                <label className="field" style={{ maxWidth: "8rem" }}>
                  <span>{info.count}</span>
                  <input type="number" min={1} max={50} value={b.count} onChange={(e) => update(i, { count: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} />
                </label>
              ) : null}
              {info.layout && prefix === "home" ? (
                <label className="field" style={{ maxWidth: "10rem" }}>
                  <span>Layout</span>
                  <select value={b.layout} onChange={(e) => update(i, { layout: e.target.value as ContentBlock["layout"] })}>
                    <option value="list">List</option>
                    <option value="grid">Grid</option>
                    <option value="cards">Cards with images</option>
                  </select>
                </label>
              ) : null}
              {b.type === "category" ? (
                <label className="field">
                  <span>Topic</span>
                  <select value={b.categoryId} onChange={(e) => update(i, { categoryId: e.target.value })}>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {b.type === "tag" ? (
                <label className="field">
                  <span>Tag</span>
                  <select value={b.tagId} onChange={(e) => update(i, { tagId: e.target.value })}>
                    {tags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            {b.type === "share" && share && onShareChange ? <ShareButtonsEditor value={share} onChange={onShareChange} /> : null}
            {b.type === "text" || b.type === "cta" ? (
              <label className="field">
                <span>{b.type === "text" ? "Text" : "Short text (optional)"}</span>
                <textarea value={b.body} maxLength={5000} onChange={(e) => update(i, { body: e.target.value })} />
              </label>
            ) : null}
            {b.type === "cta" ? (
              <div className="filters">
                <label className="field">
                  <span>Button label</span>
                  <input value={b.ctaLabel} maxLength={80} onChange={(e) => update(i, { ctaLabel: e.target.value })} />
                </label>
                <label className="field">
                  <span>Button link (/page or https://…)</span>
                  <input value={b.ctaHref} maxLength={500} onChange={(e) => update(i, { ctaHref: e.target.value })} />
                </label>
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="filters" style={{ alignItems: "end" }}>
        <label className="field">
          <span>Add a block</span>
          <select value={adding} onChange={(e) => setAdding(e.target.value as BlockType)} data-testid={`${prefix}-add-type`}>
            {types.map((t) => (
              <option key={t} value={t}>
                {BLOCK_INFO[t].name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn--ghost" onClick={add} data-testid={`${prefix}-add`}>
          Add block
        </button>
      </div>
    </div>
  );
}
