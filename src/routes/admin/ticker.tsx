import { createFileRoute } from "@tanstack/react-router";
import { adminPending } from "@/components/admin/pending";
import { FormShell, useSiteForm } from "@/components/admin/site-form";
import { adminSettings } from "@/content/admin-api";
import type { SiteConfig } from "@/content/types";

export const Route = createFileRoute("/admin/ticker")({
  ...adminPending,
  loader: () => adminSettings(),
  component: TickerAdmin,
});

function TickerAdmin() {
  const data = Route.useLoaderData();
  const form = useSiteForm(data.site);
  const { site, patch } = form;
  const t = site.trending;
  const setT = (next: Partial<SiteConfig["trending"]>) => patch({ trending: { ...t, ...next } });
  return (
    <FormShell kicker="Site" title="Top strip / Ticker" intro="The news strip under the site header: turn it on or off, choose what it shows and how it moves." form={form}>
      <fieldset className="block-card">
        <p className="field-help">The thin strip under the header, labelled “{t.label}”. If the chosen source has nothing to show (for example none of the picked articles is still published), it shows the newest articles instead, so it never silently disappears.</p>
        <label className="check-row">
          <input type="checkbox" checked={t.enabled} onChange={(e) => setT({ enabled: e.target.checked })} />
          Show the strip
        </label>
        <div className="filters">
          <label className="field">
            <span>Label</span>
            <input value={t.label} onChange={(e) => setT({ label: e.target.value })} />
          </label>
          <label className="field">
            <span>What it shows</span>
            <select value={t.source} onChange={(e) => setT({ source: e.target.value as SiteConfig["trending"]["source"] })}>
              <option value="latest">Newest articles (automatic)</option>
              <option value="pinned">Articles I pick</option>
              <option value="popular">Most read (anonymous view counts on this site)</option>
              <option value="custom">My own text items</option>
            </select>
          </label>
          <label className="field" style={{ maxWidth: "10rem" }}>
            <span>Number of items</span>
            <input type="number" min={1} max={12} value={t.count} onChange={(e) => setT({ count: Number(e.target.value) })} />
          </label>
        </div>
        <fieldset className="adm-radios">
          <legend>How it moves</legend>
          <label className="check-row">
            <input type="radio" name="tmode" checked={t.mode === "rotate"} onChange={() => setT({ mode: "rotate", animate: false })} />
            One at a time (each item stays a few seconds, then the next)
          </label>
          <label className="check-row">
            <input type="radio" name="tmode" checked={t.mode === "scroll"} onChange={() => setT({ mode: "scroll", animate: true })} />
            Continuous scroll
          </label>
          <label className="check-row">
            <input type="radio" name="tmode" checked={t.mode === "static"} onChange={() => setT({ mode: "static", animate: false })} />
            Still (a row of items, no movement)
          </label>
        </fieldset>
        <p className="field-help">Moving strips pause when a visitor hovers or focuses them and have a pause button. Visitors who prefer reduced motion see no scrolling animation.</p>
        {t.mode === "rotate" ? (
          <label className="field">
            <span>Each item stays {t.interval} seconds</span>
            <input type="range" min={2} max={30} step={1} value={t.interval} onChange={(e) => setT({ interval: Number(e.target.value) })} />
          </label>
        ) : null}
        {t.mode === "scroll" ? (
          <label className="field">
            <span>Speed: one full loop every {t.speed} seconds (lower is faster)</span>
            <input type="range" min={10} max={180} step={5} value={t.speed} onChange={(e) => setT({ speed: Number(e.target.value) })} />
          </label>
        ) : null}
        {t.source === "pinned" ? (
          <div className="stack" style={{ gap: "0.35rem" }}>
            <span className="field-help">Pick published articles:</span>
            {data.articles.map((article) => (
              <label key={article.slug} className="check-row">
                <input
                  type="checkbox"
                  checked={t.slugs.includes(article.slug)}
                  onChange={(e) => setT({ slugs: e.target.checked ? [...t.slugs, article.slug] : t.slugs.filter((s) => s !== article.slug) })}
                />
                {article.title}
              </label>
            ))}
          </div>
        ) : null}
        {t.source === "custom" ? (
          <div className="stack" style={{ gap: "0.5rem" }}>
            {t.customItems.map((item, index) => (
              <div key={item.id} className="filters">
                <label className="field">
                  <span>Text</span>
                  <input value={item.text} onChange={(e) => setT({ customItems: t.customItems.map((x, i) => (i === index ? { ...x, text: e.target.value } : x)) })} />
                </label>
                <label className="field">
                  <span>Link (optional, e.g. /about or https://…)</span>
                  <input value={item.href} onChange={(e) => setT({ customItems: t.customItems.map((x, i) => (i === index ? { ...x, href: e.target.value } : x)) })} />
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
                onClick={() => setT({ customItems: [...t.customItems, { id: `item-${Date.now()}`, text: "New item", href: "" }] })}
              >
                Add text item
              </button>
            </p>
          </div>
        ) : null}
      </fieldset>
    </FormShell>
  );
}
