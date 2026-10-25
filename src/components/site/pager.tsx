/** t115: numbered pagination for /articles and /topics/$slug (?page=N). */
export function pageHref(basePath: string, page: number): string {
  return page <= 1 ? basePath : `${basePath}?page=${page}`;
}

/** Visible page numbers: first, last, current ±1, with gaps. */
function windowPages(page: number, pages: number): (number | "gap")[] {
  const set = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

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

/** ?page= → a positive integer; anything else that is present → -1 (404). */
export function parsePage(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : -1;
}
