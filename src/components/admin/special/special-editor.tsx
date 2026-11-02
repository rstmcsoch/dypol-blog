import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useRouter } from "@tanstack/react-router";
import {
  adminAutosaveSpecial,
  adminPublishSpecial,
  adminRestoreSpecialVersion,
  adminSaveSpecialArticle,
  adminUploadMedia,
} from "@/content/admin-api";
import type { Article, Category, CoverMotif, PublicationStatus, Tag } from "@/content/types";
import { slugify } from "@/content/validate";
import { errorText } from "../gate";
import {
  markdownToSpecialBlocks,
  specialToc,
  specialWordCount,
  type SpecialBlock,
  type SpecialBody,
  type SpecialResource,
  type SpecialSource,
} from "@/lib/special/body";
import { chartSvg } from "@/lib/special/chart";

type MediaOption = { id: string; filename: string; alt: string };
type VersionRow = { version: number; createdAt: string; createdBy: string; note: string; wordCount: number; bytes: number };

type Meta = {
  id: string | null;
  title: string;
  slug: string;
  excerpt: string;
  categoryId: string;
  topicIds: string[];
  tagIds: string[];
  motif: CoverMotif;
  featured: boolean;
  seoTitle: string;
  seoDescription: string;
  authorName: string;
  coverMediaId: string | null;
  coverCredit: string;
  scheduledAt: string;
  status: PublicationStatus;
};
type Content = { blocks: SpecialBlock[]; sources: SpecialSource[]; resources: SpecialResource[] };
type Tab = "write" | "sources" | "seo" | "versions";

const BLOCK_TYPES: Array<{ type: string; label: string }> = [
  { type: "h1", label: "H1" },
  { type: "h2", label: "H2" },
  { type: "h3", label: "H3" },
  { type: "paragraph", label: "Paragraph" },
  { type: "image", label: "Image" },
  { type: "table", label: "Table" },
  { type: "list", label: "List" },
  { type: "quote", label: "Quote" },
  { type: "callout", label: "Callout" },
  { type: "chart", label: "Chart" },
  { type: "takeaways", label: "Key points" },
  { type: "code", label: "Code" },
  { type: "divider", label: "Divider" },
];

function newBlock(kind: string): SpecialBlock {
  switch (kind) {
    case "h1": return { type: "heading", level: 1, text: "" };
    case "h2": return { type: "heading", level: 2, text: "" };
    case "h3": return { type: "heading", level: 3, text: "" };
    case "image": return { type: "image", mediaId: "", alt: "", caption: "" };
    case "table": return { type: "table", headers: ["Column 1", "Column 2"], rows: [["", ""]], caption: "" };
    case "list": return { type: "list", items: [""] };
    case "quote": return { type: "quote", text: "", attribution: "" };
    case "callout": return { type: "callout", tone: "note", title: "", text: "" };
    case "chart": return { type: "chart", chartId: "", kind: "bar", title: "", caption: "", data: { labels: ["A", "B"], series: [{ name: "Value", values: [1, 2] }] }, sourceIds: [] };
    case "takeaways": return { type: "takeaways", items: [""] };
    case "code": return { type: "code", language: "", code: "" };
    case "divider": return { type: "divider" };
    default: return { type: "paragraph", text: "" };
  }
}

function blockLabel(b: SpecialBlock): string {
  if (b.type === "heading") return `H${b.level}`;
  return BLOCK_TYPES.find((t) => t.type === b.type)?.label ?? b.type;
}

const toLocal = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toISOString() : null);

/** Drops empty list items / rows so half-typed blocks never fail validation. */
function cleanContent(c: Content): Content {
  const blocks: SpecialBlock[] = [];
  for (const b of c.blocks) {
    if (b.type === "list" || b.type === "takeaways") {
      const items = b.items.map((i) => i.trim()).filter(Boolean);
      if (items.length) blocks.push({ ...b, items } as SpecialBlock);
      continue;
    }
    if (b.type === "image" && !b.mediaId) continue;
    if (b.type === "table") {
      const rows = b.rows.filter((r) => r.some((x) => x.trim()));
      blocks.push({ ...b, rows, caption: b.caption || undefined });
      continue;
    }
    if ((b.type === "quote" || b.type === "callout") && !b.text.trim()) continue;
    blocks.push(b);
  }
  return {
    blocks,
    sources: c.sources.filter((s) => s.url.trim() && s.title.trim()),
    resources: c.resources.filter((r) => r.url.trim() && r.title.trim()),
  };
}

function providerOf(url: string): SpecialResource["provider"] {
  try {
    const h = new URL(url).hostname;
    if (/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/.test(h)) return "google-drive";
    if (/(^|\.)onedrive\.live\.com$|(^|\.)1drv\.ms$|sharepoint\.com$/.test(h)) return "onedrive";
    if (/(^|\.)dropbox\.com$/.test(h)) return "dropbox";
    if (/(^|\.)drive\.proton\.me$/.test(h)) return "proton-drive";
  } catch { /* not a url yet */ }
  return "link";
}

const uid = (p: string) => `${p}${Math.random().toString(36).slice(2, 8)}`;

export function SpecialEditor({
  article,
  body,
  versions = [],
  autosave,
  autosaveAt,
  categories,
  tags,
  media: initialMedia,
}: {
  article: Article | null;
  body: SpecialBody | null;
  versions?: VersionRow[];
  autosave?: SpecialBody | null;
  autosaveAt?: string | null;
  categories: Category[];
  tags: Tag[];
  media: MediaOption[];
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const initialMeta: Meta = useMemo(() => ({
    id: article?.id ?? null,
    title: article?.title ?? "",
    slug: article?.slug ?? "",
    excerpt: article?.excerpt ?? "",
    categoryId: article?.categoryId ?? categories[0]?.id ?? "",
    topicIds: (article?.topicIds ?? []).filter((id) => id !== article?.categoryId),
    tagIds: article?.tagIds ?? [],
    motif: article?.motif ?? "corner",
    featured: article?.featured ?? false,
    seoTitle: article?.seoTitle ?? "",
    seoDescription: article?.seoDescription ?? "",
    authorName: article?.authorName ?? "",
    coverMediaId: article?.coverMediaId ?? null,
    coverCredit: body?.coverCredit ?? "",
    scheduledAt: toLocal(article?.scheduledAt),
    status: article?.status ?? "draft",
  }), [article, body, categories]);
  const initialContent: Content = useMemo(() => ({
    blocks: body?.blocks ?? [newBlock("h1"), newBlock("paragraph")],
    sources: body?.sources ?? [],
    resources: body?.resources ?? [],
  }), [body]);
  const [meta, setMeta] = useState<Meta>(initialMeta);
  const [content, setContent] = useState<Content>(initialContent);
  const [baseline, setBaseline] = useState(() => JSON.stringify([initialMeta, initialContent]));
  const [slugTouched, setSlugTouched] = useState(Boolean(article));
  const [tab, setTab] = useState<Tab>("write");
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoState, setAutoState] = useState<string>("");
  const [media, setMedia] = useState(initialMedia);
  const [pendingAutosave, setPendingAutosave] = useState(autosave ?? null);
  const [importText, setImportText] = useState("");
  const dirty = JSON.stringify([meta, content]) !== baseline;
  const blocker = useBlocker({ shouldBlockFn: () => dirty && !pending, enableBeforeUnload: () => dirty && !pending, withResolver: true });

  const words = specialWordCount(content.blocks);
  const toc = specialToc(content.blocks);
  const contentRef = useRef(content);
  contentRef.current = content;

  // Autosave: every 20 s while there are unsaved changes (server copy once the article exists).
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      const c = cleanContent(contentRef.current);
      if (meta.id) {
        setAutoState("Autosaving…");
        void adminAutosaveSpecial({ data: { id: meta.id, content: c } })
          .then((r) => setAutoState(`Autosaved ${new Date(r.savedAt).toLocaleTimeString()}`))
          .catch(() => setAutoState("Autosave failed — your text is still here; save manually."));
      } else {
        try {
          localStorage.setItem("dypol-special-new", JSON.stringify({ meta, content: c, at: Date.now() }));
          setAutoState("Draft kept on this device until the first save");
        } catch { /* storage full or blocked */ }
      }
    }, 20_000);
    return () => clearTimeout(t);
  }, [dirty, meta, content]);

  // A brand-new editor offers the device copy back.
  useEffect(() => {
    if (meta.id) return;
    try {
      const raw = localStorage.getItem("dypol-special-new");
      if (!raw) return;
      const saved = JSON.parse(raw) as { meta: Meta; content: Content; at: number };
      if (Date.now() - saved.at < 7 * 864e5) setPendingAutosave({ schema: "dypol.special-body", version: 0, articleId: "", savedAt: new Date(saved.at).toISOString(), ...saved.content } as SpecialBody);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patchMeta(p: Partial<Meta>) { setMeta((m) => ({ ...m, ...p })); }
  function setBlock(i: number, b: SpecialBlock) { setContent((c) => ({ ...c, blocks: c.blocks.map((x, j) => (j === i ? b : x)) })); }
  function insertBlock(i: number, b: SpecialBlock) { setContent((c) => ({ ...c, blocks: [...c.blocks.slice(0, i), b, ...c.blocks.slice(i)] })); }
  function moveBlock(i: number, d: -1 | 1) {
    setContent((c) => {
      const t = i + d;
      if (t < 0 || t >= c.blocks.length) return c;
      const next = [...c.blocks];
      const [x] = next.splice(i, 1);
      next.splice(t, 0, x);
      return { ...c, blocks: next };
    });
  }

  async function commit(intent: "save" | "publish" | "unpublish") {
    setPending(intent);
    setError(null);
    setMessage(null);
    try {
      const clean = cleanContent(content);
      const saved = await adminSaveSpecialArticle({
        data: {
          id: meta.id,
          title: meta.title,
          slug: meta.slug,
          excerpt: meta.excerpt,
          categoryId: meta.categoryId,
          topicIds: [meta.categoryId, ...meta.topicIds.filter((t) => t !== meta.categoryId)].slice(0, 4),
          tagIds: meta.tagIds,
          motif: meta.motif,
          featured: meta.featured,
          seoTitle: meta.seoTitle,
          seoDescription: meta.seoDescription,
          ...(meta.authorName.trim() !== (article?.authorName ?? "").trim() ? { authorName: meta.authorName } : {}),
          coverMediaId: meta.coverMediaId,
          publishedAt: article?.publishedAt ?? null,
          scheduledAt: intent === "save" ? fromLocal(meta.scheduledAt) : null,
          intent,
          content: { ...clean, ...(meta.coverCredit.trim() ? { coverCredit: meta.coverCredit } : {}) },
        },
      });
      const nextMeta = { ...meta, id: saved.id, slug: saved.slug, status: saved.status as PublicationStatus };
      setMeta(nextMeta);
      setContent(clean);
      setBaseline(JSON.stringify([nextMeta, clean]));
      setSlugTouched(true);
      setPendingAutosave(null);
      try { localStorage.removeItem("dypol-special-new"); } catch { /* ignore */ }
      setMessage(intent === "publish" ? `Published (version ${saved.version}).` : intent === "unpublish" ? "Unpublished." : `Saved as version ${saved.version}.`);
      if (!meta.id) await navigate({ to: "/admin/special/$id", params: { id: saved.id } });
      await router.invalidate();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(null);
    }
  }

  async function upload(file: File, alt: string): Promise<string | null> {
    const mime = file.type as "image/jpeg";
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime)) { setError("Images must be JPEG, PNG, WebP or GIF."); return null; }
    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    try {
      const out = await adminUploadMedia({ data: { filename: file.name, mime, alt, dataBase64 } });
      setMedia((m) => [{ id: out.id, filename: file.name, alt }, ...m]);
      return out.id;
    } catch (caught) {
      setError(errorText(caught));
      return null;
    }
  }

  const seoTitleLen = (meta.seoTitle || meta.title).trim().length;
  const seoDescLen = (meta.seoDescription || meta.excerpt).trim().length;
  const imagesMissingAlt = content.blocks.filter((b) => b.type === "image" && b.mediaId && !b.alt.trim()).length;
  const checks = [
    { ok: meta.title.trim().length >= 20 && seoTitleLen <= 65, label: "Title 20–65 characters" },
    { ok: seoDescLen >= 70 && seoDescLen <= 165, label: "Description 70–165 characters" },
    { ok: Boolean(meta.coverMediaId), label: "Featured image" },
    { ok: toc.length >= 2, label: "At least two H1/H2 sections" },
    { ok: content.sources.length >= 1, label: "At least one reference" },
    { ok: imagesMissingAlt === 0, label: "Every image has alt text" },
    { ok: words >= 800, label: "800+ words" },
  ];

  return (
    <form className="sp-editor" onSubmit={(e) => { e.preventDefault(); void commit("save"); }}>
      <div className="sp-head">
        <div>
          <p className="desk-kicker"><span className="sp-badge">Special</span> {meta.status}{meta.id ? ` · v${versions[0]?.version ?? body?.version ?? 1}` : ""}</p>
          <h1 className="desk-title">{meta.title || "New special article"}</h1>
          <p className="desk-note">{words.toLocaleString()} words · {Math.max(1, Math.round(words / 220))} min read · {toc.length} sections · {content.sources.length} references{autoState ? ` · ${autoState}` : ""}</p>
        </div>
        <div className="sp-actions">
          {meta.id ? <a className="btn btn--ghost" href={`/preview/special/${meta.id}`} target="_blank" rel="noreferrer">Preview</a> : null}
          <button className="btn btn--ghost" type="submit" disabled={Boolean(pending)}>{pending === "save" ? "Saving…" : "Save draft"}</button>
          {meta.status === "published" ? (
            <button className="btn btn--ghost" type="button" disabled={Boolean(pending)} onClick={() => void commit("unpublish")}>Unpublish</button>
          ) : null}
          <button className="btn" type="button" disabled={Boolean(pending)} onClick={() => void commit("publish")}>{pending === "publish" ? "Publishing…" : meta.status === "published" ? "Update live" : "Publish"}</button>
        </div>
      </div>
      {error ? <p className="banner banner--bad" role="alert">{error}</p> : null}
      {message ? <p className="banner" role="status">{message}</p> : null}
      {pendingAutosave ? (
        <div className="banner banner--warn" role="status">
          <p>An autosaved copy from {new Date(autosaveAt ?? pendingAutosave.savedAt).toLocaleString()} is newer than the saved version.</p>
          <div className="inline-actions">
            <button type="button" className="btn" onClick={() => { setContent({ blocks: pendingAutosave.blocks, sources: pendingAutosave.sources, resources: pendingAutosave.resources }); setPendingAutosave(null); }}>Restore autosave</button>
            <button type="button" className="btn btn--ghost" onClick={() => { setPendingAutosave(null); try { localStorage.removeItem("dypol-special-new"); } catch { /* ignore */ } }}>Discard</button>
          </div>
        </div>
      ) : null}
      {blocker.status === "blocked" ? (
        <div className="banner" role="alert">
          <p>Leave without saving? Autosave keeps a copy, but it is not a saved version.</p>
          <div className="inline-actions">
            <button type="button" className="btn" onClick={() => blocker.proceed()}>Leave</button>
            <button type="button" className="btn btn--ghost" onClick={() => blocker.reset()}>Stay</button>
          </div>
        </div>
      ) : null}

      <nav className="sp-tabs" role="tablist" aria-label="Editor sections">
        {([["write", "Write"], ["sources", `Sources & files (${content.sources.length + content.resources.length})`], ["seo", "SEO & settings"], ["versions", `Versions (${versions.length})`]] as Array<[Tab, string]>).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "sp-tab is-active" : "sp-tab"} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {tab === "write" ? (
        <div className="sp-grid">
          <div className="sp-main">
            <section className="sp-card">
              <label className="field"><span>Title</span>
                <input value={meta.title} required maxLength={200} onChange={(e) => { const title = e.target.value; setMeta((m) => ({ ...m, title, slug: slugTouched ? m.slug : slugify(title) })); }} />
              </label>
              <label className="field"><span>Standfirst / excerpt</span>
                <textarea rows={3} maxLength={500} value={meta.excerpt} onChange={(e) => patchMeta({ excerpt: e.target.value })} />
                <span className="field-help">{meta.excerpt.trim().length}/500 · shown under the title, on cards and in search.</span>
              </label>
            </section>
            {content.blocks.map((block, i) => (
              <section key={i} className={`sp-card sp-block sp-block--${block.type}`}>
                <header className="sp-block__head">
                  <span className="sp-block__type">{blockLabel(block)}</span>
                  <div className="sp-block__tools">
                    <button type="button" className="btn btn--ghost btn--sm" aria-label="Move up" onClick={() => moveBlock(i, -1)} disabled={i === 0}>↑</button>
                    <button type="button" className="btn btn--ghost btn--sm" aria-label="Move down" onClick={() => moveBlock(i, 1)} disabled={i === content.blocks.length - 1}>↓</button>
                    <button type="button" className="btn btn--ghost btn--sm" aria-label="Duplicate block" onClick={() => insertBlock(i + 1, structuredClone(block))}>⧉</button>
                    <button type="button" className="btn btn--ghost btn--sm btn--danger" aria-label="Remove block" onClick={() => setContent((c) => ({ ...c, blocks: c.blocks.filter((_, j) => j !== i) }))}>✕</button>
                  </div>
                </header>
                <SpecialBlockFields block={block} media={media} sources={content.sources} onChange={(b) => setBlock(i, b)} onUpload={upload} />
                <AddBar onAdd={(k) => insertBlock(i + 1, newBlock(k))} compact />
              </section>
            ))}
            <section className="sp-card sp-card--soft">
              <p className="sp-card__title">Add a block</p>
              <AddBar onAdd={(k) => setContent((c) => ({ ...c, blocks: [...c.blocks, newBlock(k)] }))} />
              <details className="sp-import">
                <summary>Paste Markdown</summary>
                <p className="desk-note"># / ## / ### headings, lists, tables, &gt; quotes, <code>![alt](media:ID "caption")</code> images and <code>```chart</code> JSON fences are converted to blocks.</p>
                <textarea rows={6} value={importText} onChange={(e) => setImportText(e.target.value)} />
                <button type="button" className="btn btn--ghost" disabled={!importText.trim()} onClick={() => { setContent((c) => ({ ...c, blocks: [...c.blocks, ...markdownToSpecialBlocks(importText)] })); setImportText(""); }}>Append to article</button>
              </details>
            </section>
          </div>
          <aside className="sp-side">
            <section className="sp-card">
              <p className="sp-card__title">Outline</p>
              {toc.length ? (
                <ol className="sp-outline">{toc.map((t) => <li key={t.id} className={t.level === 2 ? "is-sub" : undefined}>{t.text}</li>)}</ol>
              ) : <p className="desk-note">Add H1 and H2 headings to build the table of contents.</p>}
            </section>
            <section className="sp-card">
              <p className="sp-card__title">Ready to publish?</p>
              <ul className="sp-checks">{checks.map((c) => <li key={c.label} className={c.ok ? "is-ok" : "is-todo"}>{c.ok ? "✓" : "•"} {c.label}</li>)}</ul>
            </section>
          </aside>
        </div>
      ) : null}

      {tab === "sources" ? (
        <div className="sp-grid sp-grid--even">
          <section className="sp-card">
            <p className="sp-card__title">References</p>
            <p className="desk-note">Listed under “References” on the article. Charts can point at these ids.</p>
            {content.sources.map((s, i) => (
              <div key={s.id} className="sp-row-card">
                <div className="sp-row-card__grid">
                  <label className="field"><span>Title</span><input value={s.title} onChange={(e) => setContent((c) => ({ ...c, sources: c.sources.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) }))} /></label>
                  <label className="field"><span>URL (https)</span><input type="url" value={s.url} onChange={(e) => setContent((c) => ({ ...c, sources: c.sources.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) }))} /></label>
                  <label className="field"><span>Publisher</span><input value={s.publisher ?? ""} onChange={(e) => setContent((c) => ({ ...c, sources: c.sources.map((x, j) => (j === i ? { ...x, publisher: e.target.value } : x)) }))} /></label>
                  <label className="field"><span>Kind</span>
                    <select value={s.kind} onChange={(e) => setContent((c) => ({ ...c, sources: c.sources.map((x, j) => (j === i ? { ...x, kind: e.target.value as SpecialSource["kind"] } : x)) }))}>
                      {["web", "academic", "dataset", "document", "news", "other"].map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </label>
                </div>
                <div className="inline-actions"><span className="desk-note">id: {s.id}</span><button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => setContent((c) => ({ ...c, sources: c.sources.filter((_, j) => j !== i) }))}>Remove</button></div>
              </div>
            ))}
            <button type="button" className="btn btn--ghost" onClick={() => setContent((c) => ({ ...c, sources: [...c.sources, { id: uid("s"), title: "", url: "", kind: "web" }] }))}>+ Add reference</button>
          </section>
          <section className="sp-card">
            <p className="sp-card__title">Documents &amp; external files</p>
            <p className="desk-note">Shown as “Documents &amp; resources”. Paste a share link from Google Drive, OneDrive, Dropbox or Proton Drive (only public share links work for readers).</p>
            {content.resources.map((r, i) => (
              <div key={r.id} className="sp-row-card">
                <div className="sp-row-card__grid">
                  <label className="field"><span>Title</span><input value={r.title} onChange={(e) => setContent((c) => ({ ...c, resources: c.resources.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) }))} /></label>
                  <label className="field"><span>Share URL (https)</span><input type="url" value={r.url} onChange={(e) => setContent((c) => ({ ...c, resources: c.resources.map((x, j) => (j === i ? { ...x, url: e.target.value, provider: providerOf(e.target.value) } : x)) }))} /></label>
                  <label className="field sp-span-2"><span>Description</span><input value={r.description ?? ""} onChange={(e) => setContent((c) => ({ ...c, resources: c.resources.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) }))} /></label>
                </div>
                <div className="inline-actions"><span className="sp-pill">{r.provider}</span><button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => setContent((c) => ({ ...c, resources: c.resources.filter((_, j) => j !== i) }))}>Remove</button></div>
              </div>
            ))}
            <button type="button" className="btn btn--ghost" onClick={() => setContent((c) => ({ ...c, resources: [...c.resources, { id: uid("r"), title: "", url: "", provider: "link" }] }))}>+ Add document</button>
          </section>
        </div>
      ) : null}

      {tab === "seo" ? (
        <div className="sp-grid sp-grid--even">
          <section className="sp-card">
            <p className="sp-card__title">Search &amp; sharing</p>
            <label className="field"><span>Slug</span><input value={meta.slug} onChange={(e) => { setSlugTouched(true); patchMeta({ slug: e.target.value }); }} /><span className="field-help">/special/{meta.slug || slugify(meta.title) || "…"}</span></label>
            <label className="field"><span>SEO title</span><input value={meta.seoTitle} maxLength={200} placeholder={meta.title} onChange={(e) => patchMeta({ seoTitle: e.target.value })} /><span className="field-help">{seoTitleLen}/60</span></label>
            <label className="field"><span>SEO description</span><textarea rows={3} maxLength={300} value={meta.seoDescription} placeholder={meta.excerpt} onChange={(e) => patchMeta({ seoDescription: e.target.value })} /><span className="field-help">{seoDescLen}/160</span></label>
            <div className="sp-serp" aria-label="Search result preview">
              <span className="sp-serp__url">blog.dypol.workers.dev › special › {meta.slug || "…"}</span>
              <strong className="sp-serp__title">{(meta.seoTitle || meta.title || "Title").slice(0, 65)}</strong>
              <span className="sp-serp__desc">{(meta.seoDescription || meta.excerpt || "Description").slice(0, 165)}</span>
            </div>
            <ul className="sp-checks">{checks.map((c) => <li key={c.label} className={c.ok ? "is-ok" : "is-todo"}>{c.ok ? "✓" : "•"} {c.label}</li>)}</ul>
          </section>
          <section className="sp-card">
            <p className="sp-card__title">Featured image</p>
            <MediaPicker value={meta.coverMediaId} media={media} onChange={(id) => patchMeta({ coverMediaId: id })} onUpload={upload} />
            <label className="field"><span>Image credit</span><input value={meta.coverCredit} maxLength={300} onChange={(e) => patchMeta({ coverCredit: e.target.value })} /></label>
          </section>
          <section className="sp-card">
            <p className="sp-card__title">Topics &amp; tags</p>
            <label className="field"><span>Main topic</span>
              <select value={meta.categoryId} onChange={(e) => patchMeta({ categoryId: e.target.value, topicIds: meta.topicIds.filter((t) => t !== e.target.value) })}>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <div className="sp-chips" role="group" aria-label="More topics">
              {categories.filter((c) => c.id !== meta.categoryId).map((c) => (
                <label key={c.id} className={meta.topicIds.includes(c.id) ? "sp-chip is-on" : "sp-chip"}>
                  <input type="checkbox" checked={meta.topicIds.includes(c.id)} disabled={!meta.topicIds.includes(c.id) && meta.topicIds.length >= 3} onChange={(e) => patchMeta({ topicIds: e.target.checked ? [...meta.topicIds, c.id] : meta.topicIds.filter((t) => t !== c.id) })} />
                  {c.label}
                </label>
              ))}
            </div>
            <p className="desk-note">Tags</p>
            <div className="sp-chips" role="group" aria-label="Tags">
              {tags.map((t) => (
                <label key={t.id} className={meta.tagIds.includes(t.id) ? "sp-chip is-on" : "sp-chip"}>
                  <input type="checkbox" checked={meta.tagIds.includes(t.id)} onChange={(e) => patchMeta({ tagIds: e.target.checked ? [...meta.tagIds, t.id] : meta.tagIds.filter((x) => x !== t.id) })} />
                  {t.label}
                </label>
              ))}
            </div>
          </section>
          <section className="sp-card">
            <p className="sp-card__title">Byline &amp; schedule</p>
            <label className="field"><span>Author (byline)</span><input value={meta.authorName} maxLength={60} placeholder="DYPOL LABS" onChange={(e) => patchMeta({ authorName: e.target.value })} /></label>
            <label className="field"><span>Schedule publish (draft only)</span><input type="datetime-local" value={meta.scheduledAt} onChange={(e) => patchMeta({ scheduledAt: e.target.value })} /><span className="field-help">Goes live on the first request after this time, only if a saved version exists.</span></label>
            <label className="check-row"><input type="checkbox" checked={meta.featured} onChange={(e) => patchMeta({ featured: e.target.checked })} /> Featured on the homepage</label>
          </section>
        </div>
      ) : null}

      {tab === "versions" ? (
        <section className="sp-card">
          <p className="sp-card__title">Version history</p>
          <p className="desk-note">Every save is an immutable version. Restoring copies an old version into a new one — nothing is overwritten.</p>
          {versions.length === 0 ? <p className="desk-note">Save once to create version 1.</p> : (
            <div className="desk-table-wrap">
              <table className="desk-table sp-versions">
                <thead><tr><th>Version</th><th>Saved</th><th>By</th><th>Words</th><th>Note</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {versions.map((v, i) => (
                    <tr key={v.version}>
                      <td>v{v.version}{i === 0 ? <span className="sp-pill sp-pill--ok">current</span> : null}</td>
                      <td>{new Date(v.createdAt).toLocaleString()}</td>
                      <td>{v.createdBy}</td>
                      <td>{v.wordCount.toLocaleString()}</td>
                      <td>{v.note}</td>
                      <td>{i === 0 || !meta.id ? null : (
                        <button type="button" className="btn btn--ghost btn--sm" disabled={Boolean(pending)} onClick={() => {
                          setPending("restore");
                          void adminRestoreSpecialVersion({ data: { id: meta.id as string, version: v.version } })
                            .then(async (r) => { setMessage(`Restored v${v.version} as v${r?.version}.`); await router.invalidate(); window.location.reload(); })
                            .catch((e: unknown) => setError(errorText(e)))
                            .finally(() => setPending(null));
                        }}>Restore</button>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {meta.id && meta.status === "published" ? (
            <p className="desk-note">Live at <Link to="/special/$slug" params={{ slug: meta.slug }} target="_blank">/special/{meta.slug}</Link>.</p>
          ) : null}
          {meta.id ? (
            <button type="button" className="btn btn--ghost" onClick={() => void adminPublishSpecial({ data: { id: meta.id as string, publish: meta.status !== "published" } }).then(() => window.location.reload()).catch((e: unknown) => setError(errorText(e)))}>
              {meta.status === "published" ? "Unpublish current version" : "Publish current saved version"}
            </button>
          ) : null}
        </section>
      ) : null}
    </form>
  );
}

function AddBar({ onAdd, compact = false }: { onAdd: (kind: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  if (compact && !open) return <button type="button" className="sp-addline" onClick={() => setOpen(true)} aria-label="Insert a block below">+ Insert below</button>;
  return (
    <div className="sp-addbar" role="group" aria-label="Insert block">
      {BLOCK_TYPES.map((t) => (
        <button key={t.type} type="button" className="sp-addbar__btn" onClick={() => { onAdd(t.type); if (compact) setOpen(false); }}>{t.label}</button>
      ))}
    </div>
  );
}

function MediaPicker({ value, media, onChange, onUpload }: { value: string | null; media: MediaOption[]; onChange: (id: string | null) => void; onUpload: (f: File, alt: string) => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="sp-media">
      {value ? <img className="sp-media__thumb" src={`/media/${value}`} alt="" /> : <div className="sp-media__thumb sp-media__thumb--empty">No image</div>}
      <div className="stack">
        <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Choose from the library</option>
          {media.map((m) => <option key={m.id} value={m.id}>{m.filename}</option>)}
        </select>
        <label className="btn btn--ghost sp-upload">
          {busy ? "Uploading…" : "Upload image"}
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            void onUpload(f, "").then((id) => { if (id) onChange(id); }).finally(() => setBusy(false));
          }} />
        </label>
      </div>
    </div>
  );
}

function SpecialBlockFields({ block, media, sources, onChange, onUpload }: { block: SpecialBlock; media: MediaOption[]; sources: SpecialSource[]; onChange: (b: SpecialBlock) => void; onUpload: (f: File, alt: string) => Promise<string | null> }) {
  switch (block.type) {
    case "heading":
      return (
        <div className="sp-inline">
          <select aria-label="Heading level" value={block.level} onChange={(e) => onChange({ ...block, level: Number(e.target.value) as 1 | 2 | 3 })}>
            <option value={1}>H1 · section</option><option value={2}>H2 · subsection</option><option value={3}>H3 · minor</option>
          </select>
          <input className={`sp-heading-input sp-heading-input--${block.level}`} aria-label="Heading text" value={block.text} placeholder="Heading" onChange={(e) => onChange({ ...block, text: e.target.value })} />
        </div>
      );
    case "paragraph":
      return <textarea className="sp-prose" aria-label="Paragraph" rows={Math.min(14, Math.max(3, Math.ceil(block.text.length / 90)))} value={block.text} placeholder="Write… **bold**, *italic*, [link](https://…)" onChange={(e) => onChange({ ...block, text: e.target.value })} />;
    case "image":
      return (
        <div className="stack">
          <MediaPicker value={block.mediaId || null} media={media} onChange={(id) => onChange({ ...block, mediaId: id ?? "", alt: block.alt || media.find((m) => m.id === id)?.alt || "" })} onUpload={(f) => onUpload(f, block.alt)} />
          <div className="sp-row-card__grid">
            <label className="field"><span>Alt text (required)</span><input value={block.alt} maxLength={300} onChange={(e) => onChange({ ...block, alt: e.target.value })} /></label>
            <label className="field"><span>Credit</span><input value={block.credit ?? ""} maxLength={300} onChange={(e) => onChange({ ...block, credit: e.target.value })} /></label>
            <label className="field sp-span-2"><span>Caption</span><input value={block.caption ?? ""} maxLength={600} onChange={(e) => onChange({ ...block, caption: e.target.value })} /></label>
          </div>
        </div>
      );
    case "list":
    case "takeaways":
      return (
        <div className="stack">
          {block.type === "list" ? <label className="check-row"><input type="checkbox" checked={Boolean(block.ordered)} onChange={(e) => onChange({ ...block, ordered: e.target.checked })} /> Numbered</label> : null}
          <textarea rows={Math.max(3, block.items.length + 1)} aria-label="Items, one per line" value={block.items.join("\n")} onChange={(e) => onChange({ ...block, items: e.target.value.split("\n") } as SpecialBlock)} />
          <span className="field-help">One item per line.</span>
        </div>
      );
    case "quote":
      return (
        <div className="stack">
          <textarea rows={3} aria-label="Quote" value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} />
          <input aria-label="Attribution" placeholder="— Attribution" value={block.attribution ?? ""} onChange={(e) => onChange({ ...block, attribution: e.target.value })} />
        </div>
      );
    case "callout":
      return (
        <div className="stack">
          <div className="sp-inline">
            <select aria-label="Callout tone" value={block.tone} onChange={(e) => onChange({ ...block, tone: e.target.value as "note" })}>
              <option value="note">Note</option><option value="takeaway">Key takeaway</option><option value="tip">Tip</option><option value="warning">Warning</option>
            </select>
            <input aria-label="Callout title" placeholder="Title (optional)" value={block.title ?? ""} onChange={(e) => onChange({ ...block, title: e.target.value })} />
          </div>
          <textarea rows={3} aria-label="Callout text" value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} />
        </div>
      );
    case "code":
      return (
        <div className="stack">
          <input aria-label="Language" placeholder="language (optional)" value={block.language ?? ""} onChange={(e) => onChange({ ...block, language: e.target.value })} />
          <textarea className="sp-code" rows={6} aria-label="Code" value={block.code} onChange={(e) => onChange({ ...block, code: e.target.value })} />
        </div>
      );
    case "divider":
      return <hr className="sp-divider" />;
    case "table":
      return <TableFields block={block} onChange={onChange} />;
    case "chart":
      return <ChartFields block={block} sources={sources} onChange={onChange} />;
    case "specs":
      return <p className="desk-note">Key-specs card ({block.rows.length} rows).</p>;
  }
}

function TableFields({ block, onChange }: { block: Extract<SpecialBlock, { type: "table" }>; onChange: (b: SpecialBlock) => void }) {
  const cols = Math.max(1, block.headers.length);
  const setCell = (r: number, c: number, v: string) => onChange({ ...block, rows: block.rows.map((row, i) => (i === r ? Array.from({ length: cols }, (_, j) => (j === c ? v : row[j] ?? "")) : row)) });
  return (
    <div className="stack">
      <div className="adm-scroll-x">
        <table className="sp-gridtable">
          <thead><tr>{block.headers.map((h, c) => <th key={c}><input aria-label={`Header ${c + 1}`} value={h} onChange={(e) => onChange({ ...block, headers: block.headers.map((x, j) => (j === c ? e.target.value : x)) })} /></th>)}</tr></thead>
          <tbody>{block.rows.map((row, r) => <tr key={r}>{Array.from({ length: cols }, (_, c) => <td key={c}><input aria-label={`Row ${r + 1} column ${c + 1}`} value={row[c] ?? ""} onChange={(e) => setCell(r, c, e.target.value)} /></td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="inline-actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange({ ...block, rows: [...block.rows, Array(cols).fill("")] })}>+ Row</button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={cols >= 20} onClick={() => onChange({ ...block, headers: [...block.headers, `Column ${cols + 1}`], rows: block.rows.map((r) => [...r, ""]) })}>+ Column</button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={block.rows.length <= 1} onClick={() => onChange({ ...block, rows: block.rows.slice(0, -1) })}>− Row</button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={cols <= 1} onClick={() => onChange({ ...block, headers: block.headers.slice(0, -1), rows: block.rows.map((r) => r.slice(0, cols - 1)) })}>− Column</button>
      </div>
      <label className="field"><span>Caption</span><input value={block.caption ?? ""} maxLength={400} onChange={(e) => onChange({ ...block, caption: e.target.value })} /></label>
    </div>
  );
}

function ChartFields({ block, sources, onChange }: { block: Extract<SpecialBlock, { type: "chart" }>; sources: SpecialSource[]; onChange: (b: SpecialBlock) => void }) {
  const [csv, setCsv] = useState(() => [["label", ...block.data.series.map((s) => s.name)].join(","), ...block.data.labels.map((l, i) => [l, ...block.data.series.map((s) => s.values[i] ?? "")].join(","))].join("\n"));
  const [problem, setProblem] = useState<string | null>(null);
  function apply(text: string) {
    setCsv(text);
    const rows = text.split(/\r?\n/).map((l) => l.split(",").map((x) => x.trim())).filter((r) => r.some(Boolean));
    if (rows.length < 3 || rows[0].length < 2) { setProblem("Header row + at least two data rows: label,value[,value…]"); return; }
    const names = rows[0].slice(1);
    const body = rows.slice(1, 61);
    const series = names.map((name, c) => ({ name: name || `Series ${c + 1}`, values: body.map((r) => Number(r[c + 1])) }));
    if (series.some((s) => s.values.some((v) => !Number.isFinite(v)))) { setProblem("Every value must be a number."); return; }
    setProblem(null);
    onChange({ ...block, data: { labels: body.map((r) => r[0]), series: series.slice(0, 6) } });
  }
  return (
    <div className="sp-chart-edit">
      <div className="stack">
        <div className="sp-inline">
          <select aria-label="Chart type" value={block.kind} onChange={(e) => onChange({ ...block, kind: e.target.value as "bar" })}>
            <option value="bar">Bar</option><option value="line">Line</option><option value="pie">Pie</option>
          </select>
          <input aria-label="Chart title" placeholder="Chart title" value={block.title} onChange={(e) => onChange({ ...block, title: e.target.value })} />
        </div>
        <textarea className="sp-code" rows={6} aria-label="Chart data as CSV" value={csv} onChange={(e) => apply(e.target.value)} />
        {problem ? <span className="field-help sp-bad">{problem}</span> : <span className="field-help">CSV: first column = labels, other columns = series. Numbers are kept with the article, so the chart stays traceable to its data.</span>}
        <input aria-label="Caption" placeholder="Caption / what the chart shows" value={block.caption ?? ""} onChange={(e) => onChange({ ...block, caption: e.target.value })} />
        {sources.length ? (
          <select aria-label="Data source" value={block.sourceIds[0] ?? ""} onChange={(e) => onChange({ ...block, sourceIds: e.target.value ? [e.target.value] : [] })}>
            <option value="">Data source (reference)</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.title || s.url}</option>)}
          </select>
        ) : null}
      </div>
      <div className="sp-chart-preview" aria-hidden="true" dangerouslySetInnerHTML={{ __html: chartSvg(block) }} />
    </div>
  );
}
