/** t115: numbered pagination for /articles and /topics/$slug (?page=N). */
export function pageHref(basePath: string, page: number): string {
  return page <= 1 ? basePath : `${basePath}?page=${page}`;
}

/** Visible page numbers: first, last, current ±1, with gaps. */
export function windowPages(page: number, pages: number): (number | "gap")[] {
  const set = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] === 2) out.push(n - 1);
    else if (i > 0 && n - sorted[i - 1] > 2) out.push("gap");
    out.push(n);
  });
  return out;
}

/** ?page= → a positive integer; anything else that is present → -1 (404). */
export function parsePage(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : -1;
}
