/**
 * t173: CSV / spreadsheet analysis for special articles. Pure.
 * analyzeTable() gives per-column stats; chartFromTable() builds chart data
 * from named columns, so every chart in a special article is traceable to the
 * dataset rows it came from (the dataset itself is stored as research data).
 */
import type { ChartData, ChartKind } from "./body.ts";

export type ColumnStats = {
  name: string;
  type: "number" | "text" | "date" | "empty";
  filled: number;
  distinct: number;
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  sum?: number;
  sample: string[];
};

export function toNumber(v: string): number | null {
  const s = v.trim().replace(/[,\s]/g, "").replace(/^\$|%$/g, "");
  if (!s || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function analyzeTable(rows: string[][], opts: { header?: boolean } = {}) {
  const header = opts.header ?? true;
  const head = header ? (rows[0] ?? []) : (rows[0] ?? []).map((_, i) => `Column ${i + 1}`);
  const body = header ? rows.slice(1) : rows;
  const width = Math.min(60, Math.max(head.length, ...body.slice(0, 200).map((r) => r.length)));
  const columns: ColumnStats[] = [];
  for (let c = 0; c < width; c += 1) {
    const name = (head[c] ?? "").trim() || `Column ${c + 1}`;
    const values = body.map((r) => (r[c] ?? "").trim()).filter(Boolean);
    const nums = values.map(toNumber).filter((n): n is number => n !== null);
    const dates = values.filter((v) => /^\d{4}-\d{2}(-\d{2})?/.test(v) && !Number.isNaN(Date.parse(v)));
    const type: ColumnStats["type"] = !values.length ? "empty" : nums.length / values.length >= 0.9 ? "number" : dates.length / values.length >= 0.9 ? "date" : "text";
    const stat: ColumnStats = { name, type, filled: values.length, distinct: new Set(values).size, sample: [...new Set(values)].slice(0, 5) };
    if (type === "number" && nums.length) {
      const sorted = [...nums].sort((a, b) => a - b);
      const sum = nums.reduce((s, n) => s + n, 0);
      const mid = Math.floor(sorted.length / 2);
      Object.assign(stat, {
        min: sorted[0], max: sorted[sorted.length - 1], sum: round(sum), mean: round(sum / nums.length),
        median: round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2),
      });
    }
    columns.push(stat);
  }
  return { rows: body.length, columns };
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

export class DatasetError extends Error {}

/** Chart data from a label column and one or more numeric columns (by header name). Max 60 points. */
export function chartFromTable(rows: string[][], spec: { labelColumn: string; valueColumns: string[]; kind: ChartKind; limit?: number }): ChartData {
  const head = (rows[0] ?? []).map((h) => h.trim());
  const li = head.indexOf(spec.labelColumn.trim());
  if (li < 0) throw new DatasetError(`Column "${spec.labelColumn}" not found. Columns: ${head.join(", ")}`);
  const vi = spec.valueColumns.map((v) => {
    const i = head.indexOf(v.trim());
    if (i < 0) throw new DatasetError(`Column "${v}" not found. Columns: ${head.join(", ")}`);
    return i;
  });
  if (!vi.length) throw new DatasetError("Pick at least one value column.");
  if (spec.kind === "pie" && vi.length > 1) throw new DatasetError("A pie chart takes exactly one value column.");
  const limit = Math.min(60, spec.limit ?? 60);
  const body = rows.slice(1).filter((r) => (r[li] ?? "").trim()).slice(0, limit);
  const labels = body.map((r) => (r[li] ?? "").trim().slice(0, 60));
  const series = vi.map((i) => ({
    name: head[i].slice(0, 60),
    values: body.map((r) => {
      const n = toNumber(r[i] ?? "");
      if (n === null) throw new DatasetError(`Non-numeric value "${(r[i] ?? "").slice(0, 30)}" in column "${head[i]}".`);
      if (spec.kind === "pie" && n < 0) throw new DatasetError("Pie charts cannot show negative values.");
      return n;
    }),
  }));
  if (labels.length < 2) throw new DatasetError("A chart needs at least two rows.");
  return { labels, series };
}
