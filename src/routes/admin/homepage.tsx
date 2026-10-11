import { createFileRoute } from "@tanstack/react-router";
import { FormShell, move, useSiteForm } from "@/components/admin/site-form";
import { adminSettings } from "@/content/admin-api";
import type { HomeSectionId, SidebarBlock, SiteConfig } from "@/content/types";

export const Route = createFileRoute("/admin/homepage")({
  loader: () => adminSettings(),
  component: HomepageAdmin,
});

const sectionInfo: Record<HomeSectionId, { name: string; label: keyof SiteConfig["labels"]; countHelp: string; countFixed?: boolean }> = {
  featured: { name: "Featured article (big hero at the top)", label: "featured", countHelp: "Always one article: the one marked Featured, or the newest.", countFixed: true },
  also: { name: "Also filed (coloured band)", label: "also", countHelp: "How many article links the band shows." },
  latest: { name: "Latest articles list", label: "latest", countHelp: "How many articles the list shows." },
  topics: { name: "Topics grid", label: "topics", countHelp: "How many topics to show." },
};

const blockInfo: Record<SidebarBlock, { name: string; label: keyof SiteConfig["labels"] }> = {
  tags: { name: "Tags of the article", label: "tags" },
  related: { name: "Related articles", label: "alsoLike" },
  newStories: { name: "Newest articles", label: "newStories" },
  share: { name: "Share buttons (X, LinkedIn, Facebook, email, copy link)", label: "share" },
};
const allBlocks: SidebarBlock[] = ["tags", "related", "newStories", "share"];

function HomepageAdmin() {
  const data = Route.useLoaderData();
  const form = useSiteForm(data.site);
  const { site, patch } = form;
  const t = site.trending;
  const setT = (next: Partial<SiteConfig["trending"]>) => patch({ trending: { ...t, ...next } });
  const side = site.articleSidebar;
  const setSide = (next: Partial<SiteConfig["articleSidebar"]>) => patch({ articleSidebar: { ...side, ...next } });
  const setLabel = (key: keyof SiteConfig["labels"], value: string) => patch({ labels: { ...site.labels, [key]: value } });

  return (
    <FormShell kicker="Site" title="Homepage & layout" intro="Choose which homepage sections appear, in what order, and how many items each shows. Also controls the top news strip and the article sidebar." form={form}>
      <fieldset className="block-card">
        <legend>Homepage sections</legend>
        <p className="field-help">Use the arrows to reorder. Unticked sections are hidden.</p>
        {site.home.sections.map((section, index) => {
          const info = sectionInfo[section.id];
          return (
            <div key={section.id} className="block-card" style={{ boxShadow: "none" }} data-section={section.id}>
              <div className="filters" style={{ alignItems: "center" }}>
                <label className="check-row" style={{ flex: 1 }}>
                  <input
                    type="checkbox"
                    checked={section.enabled}
                    onChange={(e) => patch({ home: { sections: site.home.sections.map((s, i) => (i === index ? { ...s, enabled: e.target.checked } : s)) } })}
                  />
                  <strong>{info.name}</strong>
                </label>
                <div className="adm-row-actions">
                  <button type="button" className="btn btn--ghost" aria-label={`Move ${info.name} up`} disabled={index === 0} onClick={() => patch({ home: { sections: move(site.home.sections, index, -1) } })}>
                    ↑
                  </button>
                  <button type="button" className="btn btn--ghost" aria-label={`Move ${info.name} down`} disabled={index === site.home.sections.length - 1} onClick={() => patch({ home: { sections: move(site.home.sections, index, 1) } })}>
                    ↓
                  </button>
                </div>
              </div>
              <div className="filters">
                <label className="field">
                  <span>Heading shown on the site</span>
                  <input value={site.labels[info.label]} onChange={(e) => setLabel(info.label, e.target.value)} />
                </label>
                {info.countFixed ? null : (
                  <label className="field" style={{ maxWidth: "10rem" }}>
                    <span>Items</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={section.count}
                      onChange={(e) => patch({ home: { sections: site.home.sections.map((s, i) => (i === index ? { ...s, count: Number(e.target.value) } : s)) } })}
                    />
                  </label>
                )}
              </div>
              <p className="field-help">{info.countHelp}</p>
            </div>
          );
        })}
      </fieldset>

      <fieldset className="block-card" id="ticker">
        <legend>Top news strip (ticker)</legend>
        <p className="field-help">The thin strip under the header, labelled “{t.label}”.</p>
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
              <option value="custom">My own text items</option>
            </select>
          </label>
          <label className="field" style={{ maxWidth: "10rem" }}>
            <span>Number of items</span>
            <input type="number" min={1} max={12} value={t.count} onChange={(e) => setT({ count: Number(e.target.value) })} />
          </label>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={t.animate} onChange={(e) => setT({ animate: e.target.checked })} />
          Scroll continuously (pauses on hover; off for visitors who prefer reduced motion)
        </label>
        {t.animate ? (
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

      <fieldset className="block-card" id="sidebar">
        <legend>Article sidebar</legend>
        <p className="field-help">The column to the right of the article text on wide screens (below the text on phones). When it is off, the article uses the full width.</p>
        <label className="check-row">
          <input type="checkbox" checked={side.enabled} onChange={(e) => setSide({ enabled: e.target.checked })} />
          Show the sidebar
        </label>
        {side.enabled ? (
          <>
            {allBlocks.map((block) => {
              const at = side.blocks.indexOf(block);
              const info = blockInfo[block];
              return (
                <div key={block} className="filters" style={{ alignItems: "center" }}>
                  <label className="check-row" style={{ flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={at >= 0}
                      onChange={(e) => setSide({ blocks: e.target.checked ? [...side.blocks, block] : side.blocks.filter((b) => b !== block) })}
                    />
                    {info.name}
                  </label>
                  <label className="field" style={{ maxWidth: "16rem" }}>
                    <span>Heading</span>
                    <input value={site.labels[info.label]} onChange={(e) => setLabel(info.label, e.target.value)} />
                  </label>
                  {at >= 0 ? (
                    <div className="adm-row-actions">
                      <button type="button" className="btn btn--ghost" aria-label={`Move ${info.name} up`} disabled={at === 0} onClick={() => setSide({ blocks: move(side.blocks, at, -1) })}>
                        ↑
                      </button>
                      <button type="button" className="btn btn--ghost" aria-label={`Move ${info.name} down`} disabled={at === side.blocks.length - 1} onClick={() => setSide({ blocks: move(side.blocks, at, 1) })}>
                        ↓
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
            <label className="field" style={{ maxWidth: "14rem" }}>
              <span>Articles per list</span>
              <input type="number" min={1} max={10} value={side.count} onChange={(e) => setSide({ count: Number(e.target.value) })} />
            </label>
          </>
        ) : null}
      </fieldset>
    </FormShell>
  );
}
