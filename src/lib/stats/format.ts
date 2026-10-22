export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-IN");
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const sign = ms < 0 ? "−" : "";
  const s = Math.round(Math.abs(ms) / 1000);
  if (s < 60) return `${sign}${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${sign}${m}m ${rem}s` : `${sign}${m}m`;
  const h = Math.floor(m / 60);
  return `${sign}${h}h ${m % 60}m`;
}

export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatDelta(current: number, previous: number): { text: string; tone: "up" | "down" | "flat" | "new" } {
  if (previous === 0 && current === 0) return { text: "No change", tone: "flat" };
  if (previous === 0 && current > 0) return { text: "New", tone: "new" };
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 0.5) return { text: "0%", tone: "flat" };
  const rounded = Math.round(pct * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return { text: `${sign}${rounded}%`, tone: rounded > 0 ? "up" : "down" };
}

export function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const lines = [headers, ...rows].map((row) => row.map((cell) => csvCell(cell)).join(","));
  return `\uFEFF${lines.join("\n")}`;
}

export function istStamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
