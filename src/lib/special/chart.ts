/**
 * t173: chart SVG for special articles. Pure and deterministic: the same data
 * always gives the same bytes, so a chart in R2 can be traced back to (and
 * re-checked against) the numbers stored in the article body.
 *
 * Output is static SVG (no script, no external refs, no event handlers); every
 * label is XML-escaped. Served with `Content-Security-Policy: default-src 'none'`.
 */
import type { ChartData, ChartKind } from "./body.ts";

const PALETTE = ["#e64500", "#1d6fd1", "#0f9d6b", "#b25e09", "#7a4cc2", "#c2185b"];
const W = 720;
const H = 400;

export function xml(value: string): string {
  return value.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function fmt(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${+(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(v / 1e3).toFixed(1)}k`;
  return `${+v.toFixed(2)}`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function chartSvg(input: { kind: ChartKind; title: string; data: ChartData }): string {
  const { kind, title, data } = input;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${xml(clip(title, 120))}">`);
  parts.push(`<title>${xml(clip(title, 200))}</title>`);
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(`<text x="24" y="34" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="18" font-weight="700" fill="#111">${xml(clip(title, 70))}</text>`);
  const font = `font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"`;
  if (kind === "pie") {
    const values = data.series[0]?.values ?? [];
    const total = values.reduce((s, v) => s + Math.max(0, v), 0) || 1;
    const cx = 220, cy = 220, r = 140;
    let angle = -Math.PI / 2;
    values.forEach((v, i) => {
      const frac = Math.max(0, v) / total;
      const next = angle + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(next), y2 = cy + r * Math.sin(next);
      const color = PALETTE[i % PALETTE.length];
      if (frac >= 0.9999) parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`);
      else if (frac > 0) parts.push(`<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${color}" stroke="#fff" stroke-width="2"/>`);
      angle = next;
      const ly = 90 + i * 26;
      if (ly < H - 20) {
        parts.push(`<rect x="420" y="${ly - 12}" width="14" height="14" rx="3" fill="${color}"/>`);
        parts.push(`<text x="442" y="${ly}" ${font} font-size="14" fill="#333">${xml(clip(data.labels[i] ?? "", 26))} — ${xml(fmt(v))} (${Math.round(frac * 100)}%)</text>`);
      }
    });
    parts.push("</svg>");
    return parts.join("");
  }
  const left = 64, right = W - 24, top = 64, bottom = H - 64;
  const all = data.series.flatMap((s) => s.values);
  const min = Math.min(0, ...all);
  const max = niceMax(Math.max(0, ...all));
  const span = max - min || 1;
  const y = (v: number) => bottom - ((v - min) / span) * (bottom - top);
  for (let t = 0; t <= 4; t += 1) {
    const v = min + (span * t) / 4;
    const yy = y(v).toFixed(1);
    parts.push(`<line x1="${left}" x2="${right}" y1="${yy}" y2="${yy}" stroke="#e5e7eb" stroke-width="1"/>`);
    parts.push(`<text x="${left - 8}" y="${(+yy + 4).toFixed(1)}" text-anchor="end" ${font} font-size="12" fill="#555">${xml(fmt(v))}</text>`);
  }
  const n = data.labels.length;
  const band = (right - left) / Math.max(1, n);
  const every = Math.max(1, Math.ceil(n / 12));
  data.labels.forEach((label, i) => {
    if (i % every) return;
    parts.push(`<text x="${(left + band * i + band / 2).toFixed(1)}" y="${bottom + 20}" text-anchor="middle" ${font} font-size="12" fill="#444">${xml(clip(label, 14))}</text>`);
  });
  if (kind === "bar") {
    const groups = data.series.length;
    const barW = Math.max(2, (band * 0.75) / groups);
    data.series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        const x = left + band * i + band * 0.125 + barW * si;
        const y0 = y(Math.max(0, v)), y1 = y(Math.min(0, v));
        parts.push(`<rect x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0.5, y1 - y0).toFixed(1)}" rx="2" fill="${PALETTE[si % PALETTE.length]}"/>`);
      });
    });
  } else {
    data.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => `${(left + band * i + band / 2).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
      parts.push(`<polyline points="${pts}" fill="none" stroke="${PALETTE[si % PALETTE.length]}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
    });
  }
  parts.push(`<line x1="${left}" x2="${right}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="#9ca3af" stroke-width="1"/>`);
  if (data.series.length > 1 || data.series[0]?.name) {
    let lx = left;
    data.series.forEach((s, si) => {
      const label = clip(s.name, 22);
      parts.push(`<rect x="${lx}" y="${H - 26}" width="12" height="12" rx="2" fill="${PALETTE[si % PALETTE.length]}"/>`);
      parts.push(`<text x="${lx + 18}" y="${H - 15}" ${font} font-size="12" fill="#333">${xml(label)}</text>`);
      lx += 30 + label.length * 7;
    });
  }
  parts.push("</svg>");
  return parts.join("");
}
