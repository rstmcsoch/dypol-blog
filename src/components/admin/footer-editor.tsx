import type { SiteConfig } from "@/content/types";
import { footerColumns, type FooterColumn } from "@/lib/social-links";
import { move } from "./site-form";

export function FooterEditor({ site, pages, patch }: { site: SiteConfig; pages: { slug: string; title: string }[]; patch: (value: Partial<SiteConfig>) => void }) {
  const columns = site.footer.columns ?? footerColumns(pages);
  const save = (columns: FooterColumn[]) => patch({ footer: { ...site.footer, columns } });
  const update = (index: number, column: FooterColumn) => save(columns.map((c, i) => i === index ? column : c));
  return <fieldset className="block-card">
    <legend>Footer columns</legend>
    <p className="field-help">Starts with the current published footer. Changes are saved with Site text. Use /page for internal links or https://… for external links. Hidden standard pages stay out of the footer.</p>
    {columns.map((column, i) => <section className="block-card" key={i}>
      <label className="field"><span>Column {i + 1} heading</span><input value={column.heading} required onChange={(e) => update(i, { ...column, heading: e.target.value })} /></label>
      <div className="inline-actions">
        <button className="btn btn--ghost" type="button" disabled={i === 0} aria-label={`Move ${column.heading} up`} onClick={() => save(move(columns, i, -1))}>↑</button>
        <button className="btn btn--ghost" type="button" disabled={i === columns.length - 1} aria-label={`Move ${column.heading} down`} onClick={() => save(move(columns, i, 1))}>↓</button>
        <button className="btn btn--danger-ghost" type="button" onClick={() => save(columns.filter((_, j) => j !== i))}>Remove column</button>
      </div>
      {column.links.map((link, j) => {
        const change = (value: Partial<typeof link>) => update(i, { ...column, links: column.links.map((l, k) => k === j ? { ...l, ...value } : l) });
        return <div className="filters" key={j}>
          <label className="field"><span>Link label</span><input value={link.label} required onChange={(e) => change({ label: e.target.value })} /></label>
          <label className="field"><span>Link address</span><input value={link.href} required list="footer-page-links" onChange={(e) => change({ href: e.target.value })} /></label>
          <label className="check-row"><input type="checkbox" checked={link.newTab ?? false} onChange={(e) => change({ newTab: e.target.checked })} />New tab</label>
          <button className="btn btn--ghost" type="button" disabled={j === 0} aria-label={`Move ${link.label} up`} onClick={() => update(i, { ...column, links: move(column.links, j, -1) })}>↑</button>
          <button className="btn btn--ghost" type="button" disabled={j === column.links.length - 1} aria-label={`Move ${link.label} down`} onClick={() => update(i, { ...column, links: move(column.links, j, 1) })}>↓</button>
          <button className="btn btn--danger-ghost" type="button" onClick={() => update(i, { ...column, links: column.links.filter((_, k) => k !== j) })}>Remove link</button>
        </div>;
      })}
      <button className="btn btn--ghost" type="button" disabled={column.links.length >= 20} onClick={() => update(i, { ...column, links: [...column.links, { label: "New link", href: "/", newTab: false }] })}>Add link</button>
    </section>)}
    <button className="btn btn--ghost" type="button" disabled={columns.length >= 6} onClick={() => save([...columns, { heading: "New column", links: [] }])}>Add column</button>
    <datalist id="footer-page-links">{pages.map((p) => <option key={p.slug} value={`/${p.slug}`}>{p.title}</option>)}</datalist>
  </fieldset>;
}
