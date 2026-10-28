import { pageHref, windowPages } from "@/lib/pagination";
export { pageHref, parsePage } from "@/lib/pagination";

export function Pager({ basePath, page, pages }: { basePath: string; page: number; pages: number }) {
  if (pages <= 1) return null;
  const item = (n: number, label: string, rel?: string, extra = "") => (
    <a
      href={pageHref(basePath, n)}
      rel={rel}
      className={`pager__link ${extra}`.trim()}
      aria-current={n === page && !rel ? "page" : undefined}
    >
      {label}
    </a>
  );
  return (
    <nav className="pager" aria-label="Pagination">
      {page > 1 ? item(page - 1, "← Newer", "prev", "pager__step") : <span className="pager__link pager__step is-disabled" aria-hidden="true">← Newer</span>}
      <ol className="pager__pages">
        {windowPages(page, pages).map((n, i) =>
          n === "gap" ? (
            <li key={`gap-${i}`} className="pager__gap" aria-hidden="true">…</li>
          ) : (
            <li key={n}>{item(n, String(n), undefined, n === page ? "is-current" : "")}</li>
          ),
        )}
      </ol>
      {page < pages ? item(page + 1, "Older →", "next", "pager__step") : <span className="pager__link pager__step is-disabled" aria-hidden="true">Older →</span>}
    </nav>
  );
}
