import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FormShell, useSiteForm } from "@/components/admin/site-form";
import { adminLayout, adminSettings, adminTickerPreview } from "@/content/admin-api";
import type { TickerEntry } from "@/content/ticker";
import type { SiteConfig } from "@/content/types";

export const Route = createFileRoute("/admin/ticker")({
  loader: async () => {
    const [settings, layout] = await Promise.all([adminSettings(), adminLayout()]);
    return { ...settings, categories: layout.options.categories };
  },
  component: TickerAdmin,
});

const SOURCES: { value: SiteConfig["trending"]["source"]; label: string; help: string }[] = [
  { value: "trending", label: "Trending — most read recently", help: "Ranked by reads recorded on this site. Until reads build up, the newest articles are shown and the preview says so." },
  { value: "latest", label: "Newest articles", help: "Always the most recently published pieces." },
  { value: "featured", label: "Featured articles", help: "Articles you marked Featured, newest first." },
  { value: "category", label: "Articles in chosen topics", help: "Pick one or more topics below." },
  { value: "pinned", label: "Articles I pick", help: "Exactly the articles you tick, in this order." },
  { value: "custom", label: "My own text items", help: "Your own lines with optional links. No article needed." },
];

function TickerAdmin() {
  const data = Route.useLoaderData();
  const form = useSiteForm(data.site);
  const { site, patch } = form;
  const t = site.trending;
  const setT = (next: Partial<SiteConfig["trending"]>) => patch({ trending: { ...t, ...next } });

  const [preview, setPreview] = useState<{ items: TickerEntry[]; source: string; fallback: boolean; note: string } | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  const refresh = useCallback(async () => {
    setPreviewPending(true);
    try {
      const result = await adminTickerPreview({ data: { trending: t } });
      setPreview(result);
      setPreviewIndex(0);
    } catch {
      setPreview(null);
    } finally {
      setPreviewPending(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(t)]);

  const published = useMemo(() => data.articles, [data.articles]);
  const previewCount = preview?.items.length ?? 0;
  const previewRounded = previewIndex % Math.max(1, previewCount);
  const stepPreview = (direction: -1 | 1) =>
    setPreviewIndex((current) => (current + direction + Math.max(1, previewCount)) % Math.max(1, previewCount));

  return (
    <FormShell
      kicker="Site"
      title="Trending ticker"
      intro="The thin strip under the header. It shows one headline at a time and rotates; visitors who prefer reduced motion see no automatic movement."
      form={form}
    >
      <fieldset className="block-card">
        <legend>Behaviour</legend>
        <label className="check-row">
          <input type="checkbox" checked={t.enabled} onChange={(e) => setT({ enabled: e.target.checked })} />
          Show the strip on the public site
        </label>
        <div className="filters">
          <label className="field">
            <span>Label</span>
            <input value={t.label} maxLength={40} onChange={(e) => setT({ label: e.target.value })} />
          </label>
          <label className="field">
            <span>Mode</span>
            <select value={t.mode} onChange={(e) => setT({ mode: e.target.value as SiteConfig["trending"]["mode"] })}>
              <option value="rotate">One headline at a time (rotates)</option>
              <option value="still">One headline, no rotation</option>
            </select>
          </label>
          <label className="field" style={{ maxWidth: "12rem" }}>
            <span>Seconds per headline</span>
            <input type="number" min={3} max={60} value={t.intervalSeconds} onChange={(e) => setT({ intervalSeconds: Number(e.target.value) })} />
          </label>
          <label className="field" style={{ maxWidth: "10rem" }}>
            <span>Headlines</span>
            <input type="number" min={1} max={12} value={t.count} onChange={(e) => setT({ count: Number(e.target.value) })} />
          </label>
        </div>
        <div className="filters">
          <label className="check-row">
            <input type="checkbox" checked={t.showLabel} onChange={(e) => setT({ showLabel: e.target.checked })} />
            Show the label chip
          </label>
          <label className="check-row">
            <input type="checkbox" checked={t.showIndex} onChange={(e) => setT({ showIndex: e.target.checked })} />
            Show “2 / 5” position
          </label>
          <label className="check-row">
            <input type="checkbox" checked={t.pauseOnHover} onChange={(e) => setT({ pauseOnHover: e.target.checked })} />
            Pause while the pointer is over it
          </label>
        </div>
      </fieldset>

      <fieldset className="block-card">
        <legend>Where the headlines come from</legend>
        <label className="field">
          <span>Source</span>
          <select value={t.source} onChange={(e) => setT({ source: e.target.value as SiteConfig["trending"]["source"] })}>
            {SOURCES.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </select>
        </label>
        <p className="field-help">{SOURCES.find((source) => source.value === t.source)?.help}</p>

        {t.source === "category" ? (
          <div className="stack" style={{ gap: "0.35rem" }}>
            <span className="field-help">Topics included:</span>
            {data.categories.map((category) => (
              <label key={category.id} className="check-row">
                <input
                  type="checkbox"
                  checked={t.categories.includes(category.id)}
                  onChange={(e) => setT({ categories: e.target.checked ? [...t.categories, category.id] : t.categories.filter((id) => id !== category.id) })}
                />
                {category.label}
              </label>
            ))}
          </div>
        ) : null}

        {t.source === "pinned" ? (
          <div className="stack" style={{ gap: "0.35rem" }}>
            <span className="field-help">Tick the articles to pin. Unticking a pinned article removes it; unpublished or deleted articles are skipped automatically.</span>
            {published.map((article) => (
              <label key={article.slug} className="check-row">
                <input
                  type="checkbox"
                  checked={t.slugs.includes(article.slug)}
                  onChange={(e) => setT({ slugs: e.target.checked ? [...t.slugs, article.slug] : t.slugs.filter((slug) => slug !== article.slug) })}
                />
                {article.title}
              </label>
            ))}
            {t.slugs.some((slug) => !published.some((article) => article.slug === slug)) ? (
              <p className="field-help" role="status">
                Some pinned articles are no longer published; they are left out of the strip and can be removed here:
                {t.slugs
                  .filter((slug) => !published.some((article) => article.slug === slug))
                  .map((slug) => (
                    <button key={slug} type="button" className="btn btn--danger-ghost" style={{ marginLeft: "0.5rem" }} onClick={() => setT({ slugs: t.slugs.filter((value) => value !== slug) })}>
                      Remove {slug}
                    </button>
                  ))}
              </p>
            ) : null}
          </div>
        ) : null}

        {t.source === "custom" ? (
          <div className="stack" style={{ gap: "0.5rem" }}>
            {t.customItems.map((item, index) => (
              <div key={item.id} className="filters">
                <label className="field">
                  <span>Text</span>
                  <input value={item.text} maxLength={160} onChange={(e) => setT({ customItems: t.customItems.map((x, i) => (i === index ? { ...x, text: e.target.value } : x)) })} />
                </label>
                <label className="field">
                  <span>Link (optional, e.g. /about or https://…)</span>
                  <input value={item.href} maxLength={300} onChange={(e) => setT({ customItems: t.customItems.map((x, i) => (i === index ? { ...x, href: e.target.value } : x)) })} />
                </label>
                <button type="button" className="btn btn--danger-ghost" onClick={() => setT({ customItems: t.customItems.filter((_, i) => i !== index) })}>
                  Remove
                </button>
              </div>
            ))}
            <p>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={t.customItems.length >= 12}
                onClick={() => setT({ customItems: [...t.customItems, { id: `item-${Date.now().toString(36)}`, text: "New headline", href: "" }] })}
              >
                Add text item
              </button>
            </p>
          </div>
        ) : null}
      </fieldset>

      <fieldset className="block-card">
        <legend>Continuous scroll (older behaviour)</legend>
        <label className="check-row">
          <input type="checkbox" checked={t.animate} onChange={(e) => setT({ animate: e.target.checked })} />
          Scroll all headlines continuously instead of one at a time
        </label>
        {t.animate ? (
          <label className="field">
            <span>Speed: one full loop every {t.speed} seconds (lower is faster)</span>
            <input type="range" min={10} max={180} step={5} value={t.speed} onChange={(e) => setT({ speed: Number(e.target.value) })} />
          </label>
        ) : null}
      </fieldset>

      <fieldset className="block-card">
        <legend>Preview</legend>
        <p className="field-help">
          {preview
            ? `Showing “${preview.source}” from ${preview.items.length} headline${preview.items.length === 1 ? "" : "s"}.`
            : previewPending
              ? "Rendering…"
              : "Preview unavailable right now."}
        </p>
        {preview?.note ? <p className="field-help">{preview.note}</p> : null}
        <div className="preview-frame">
          <div className="preview-page" data-theme="light">
            {preview && preview.items.length > 0 ? (
              <div className={t.animate ? "trend trend--animate" : "trend"}>
                <div className="container trend__row">
                  {t.showLabel && t.label ? (
                    <p className="trend__label">
                      <span className="grain-layer" aria-hidden="true" />
                      <span>{t.label}</span>
                    </p>
                  ) : null}
                  <div className="trend__viewport">
                    <ul className="trend__list" style={t.animate ? { animationDuration: `${t.speed}s` } : undefined}>
                      {t.animate ? (
                        <>
                          {preview.items.map((item) => (
                            <li key={item.id}>
                              <span className="trend__link">{item.title}</span>
                            </li>
                          ))}
                          {preview.items.map((item) => (
                            <li key={`dup-${item.id}`} aria-hidden="true">
                              <span className="trend__link">{item.title}</span>
                            </li>
                          ))}
                        </>
                      ) : (
                        <li className="trend__slot" key={preview.items[previewRounded]?.id ?? "empty"}>
                          <span className="trend__link">{preview.items[previewRounded]?.title}</span>
                        </li>
                      )}
                    </ul>
                  </div>
                  {!t.animate && previewCount > 1 ? (
                    <div className="trend__controls">
                      {t.showIndex ? (
                        <p className="trend__count">
                          {previewRounded + 1} / {previewCount}
                        </p>
                      ) : null}
                      <button type="button" className="trend__step" onClick={() => stepPreview(-1)} aria-label="Previous preview headline">
                        ‹
                      </button>
                      <button type="button" className="trend__step" onClick={() => stepPreview(1)} aria-label="Next preview headline">
                        ›
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="lede">No headlines would appear — check the source and that articles are published.</p>
            )}
          </div>
        </div>
        <p>
          <button type="button" className="btn btn--ghost" disabled={previewPending} onClick={() => void refresh()}>
            {previewPending ? "Rendering…" : "Refresh preview"}
          </button>
        </p>
      </fieldset>
    </FormShell>
  );
}
