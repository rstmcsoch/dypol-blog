import type { SiteConfig } from "@/content/types";
import { footerColumns, type FooterColumn } from "@/lib/social-links";
import { move } from "./site-form";

export function FooterEditor({ site, pages, patch }: { site: SiteConfig; pages: { slug: string; title: string }[]; patch: (value: Partial<SiteConfig>) => void }) {
  const columns = site.footer.columns ?? footerColumns(pages);
  const save = (next: FooterColumn[]) => patch({ footer: { ...site.footer, columns: next } });
  const update = (index: number, column: FooterColumn) => save(columns.map((c, i) => (i === index ? column : c)));

  return (
    <fieldset className="block-card sa-card">
      <legend>Footer columns ({columns.length}/6)</legend>
      <div className="sa-card__head">
        <p className="sa-note">Starts with the current published footer. Use <code>/page</code> for internal links or <code>https://…</code> for external links. Hidden standard pages stay out of the footer.</p>
        <button className="btn btn--ghost btn--sm" type="button" disabled={columns.length >= 6} onClick={() => save([...columns, { heading: "New column", links: [] }])}>
          + Add column
        </button>
      </div>

      {columns.map((column, i) => (
        <section className="st-fcol" key={i}>
          <div className="st-fcol__head">
            <label className="field">
              <span>Column {i + 1} heading</span>
              <input value={column.heading} required onChange={(e) => update(i, { ...column, heading: e.target.value })} />
            </label>
            <div className="adm-row-actions">
              <button className="btn btn--ghost btn--sm" type="button" disabled={i === 0} aria-label={`Move ${column.heading} up`} onClick={() => save(move(columns, i, -1))}>↑</button>
              <button className="btn btn--ghost btn--sm" type="button" disabled={i === columns.length - 1} aria-label={`Move ${column.heading} down`} onClick={() => save(move(columns, i, 1))}>↓</button>
              <button className="btn btn--danger-ghost btn--sm" type="button" onClick={() => save(columns.filter((_, j) => j !== i))}>Remove column</button>
            </div>
          </div>

          <div className="st-fcol__links">
            {column.links.map((link, j) => {
              const change = (value: Partial<typeof link>) => update(i, { ...column, links: column.links.map((l, k) => (k === j ? { ...l, ...value } : l)) });
              return (
                <div className="st-fcol__row" key={j}>
                  <label className="field">
                    <span>Link label</span>
                    <input value={link.label} required onChange={(e) => change({ label: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>Link address</span>
                    <input value={link.href} required list="footer-page-links" onChange={(e) => change({ href: e.target.value })} />
                  </label>
                  <label className="check-row">
                    <input type="checkbox" checked={link.newTab ?? false} onChange={(e) => change({ newTab: e.target.checked })} />
                    New tab
                  </label>
                  <div className="adm-row-actions">
                    <button className="btn btn--ghost btn--sm" type="button" disabled={j === 0} aria-label={`Move ${link.label} up`} onClick={() => update(i, { ...column, links: move(column.links, j, -1) })}>↑</button>
                    <button className="btn btn--ghost btn--sm" type="button" disabled={j === column.links.length - 1} aria-label={`Move ${link.label} down`} onClick={() => update(i, { ...column, links: move(column.links, j, 1) })}>↓</button>
                    <button className="btn btn--danger-ghost btn--sm" type="button" onClick={() => update(i, { ...column, links: column.links.filter((_, k) => k !== j) })}>Remove</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            <button className="btn btn--ghost btn--sm" type="button" disabled={column.links.length >= 20} onClick={() => update(i, { ...column, links: [...column.links, { label: "New link", href: "/", newTab: false }] })}>
              + Add link
            </button>
          </div>
        </section>
      ))}

      <datalist id="footer-page-links">{pages.map((p) => <option key={p.slug} value={`/${p.slug}`}>{p.title}</option>)}</datalist>
    </fieldset>
  );
}
