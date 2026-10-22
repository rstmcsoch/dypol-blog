import { useEffect, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type ChartColors = { primary: string; ok: string; muted: string; line: string; text: string; surface: string; amber: string; violet: string };

const FALLBACK: ChartColors = {
  primary: "#2f5bea",
  ok: "#0f9f6e",
  muted: "#5d6675",
  line: "#e3e6eb",
  text: "#1d2330",
  surface: "#ffffff",
  amber: "#d97706",
  violet: "#7c3aed",
};

function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(FALLBACK);
  useEffect(() => {
    const desk = document.querySelector(".desk");
    if (!desk) return;
    const read = () => {
      const style = getComputedStyle(desk);
      const pick = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
      setColors({
        primary: pick("--a-primary", FALLBACK.primary),
        ok: pick("--a-ok", FALLBACK.ok),
        muted: pick("--a-muted", FALLBACK.muted),
        line: pick("--a-line", FALLBACK.line),
        text: pick("--a-text", FALLBACK.text),
        surface: pick("--a-surface", FALLBACK.surface),
        amber: "#d97706",
        violet: "#7c3aed",
      });
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(desk, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return colors;
}

export function ChartEmpty({ label }: { label: string }) {
  return <p className="stats-empty">{label}</p>;
}

function tip(colors: ChartColors) {
  return {
    contentStyle: {
      background: colors.surface,
      border: `1px solid ${colors.line}`,
      borderRadius: 8,
      color: colors.text,
      fontSize: 12,
    },
  };
}

export function TrendChart({
  data,
  compare,
}: {
  data: { label: string; views: number; other: number; prev?: number }[];
  compare: boolean;
}) {
  const colors = useChartColors();
  if (!data.some((row) => row.views || row.other || row.prev)) return <ChartEmpty label="No page views in this period yet." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={colors.line} vertical={false} />
        <XAxis dataKey="label" tick={{ fill: colors.muted, fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis tick={{ fill: colors.muted, fontSize: 11 }} width={40} allowDecimals={false} />
        <Tooltip {...tip(colors)} />
        <Legend />
        <Area type="monotone" dataKey="views" name="Article views" stroke={colors.primary} fill={colors.primary} fillOpacity={0.18} strokeWidth={2} />
        <Area type="monotone" dataKey="other" name="Other pages" stroke={colors.ok} fill={colors.ok} fillOpacity={0.12} strokeWidth={2} />
        {compare ? <Line type="monotone" dataKey="prev" name="Previous article views" stroke={colors.amber} strokeDasharray="4 4" dot={false} /> : null}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CompareBars({
  data,
}: {
  data: { label: string; current: number; previous: number }[];
}) {
  const colors = useChartColors();
  if (!data.some((row) => row.current || row.previous)) return <ChartEmpty label="Nothing to compare in this period." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={colors.line} vertical={false} />
        <XAxis dataKey="label" tick={{ fill: colors.muted, fontSize: 11 }} />
        <YAxis tick={{ fill: colors.muted, fontSize: 11 }} width={40} allowDecimals={false} />
        <Tooltip {...tip(colors)} />
        <Legend />
        <Bar dataKey="current" name="This period" fill={colors.primary} radius={[4, 4, 0, 0]} />
        <Bar dataKey="previous" name="Previous period" fill={colors.line} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const SLICE = ["#2f5bea", "#0f9f6e", "#d97706", "#7c3aed", "#e11d48", "#0891b2", "#64748b", "#b45309"];

export function DonutChart({ data }: { data: { name: string; value: number }[] }) {
  const colors = useChartColors();
  const rows = data.filter((row) => row.value > 0);
  if (!rows.length) return <ChartEmpty label="No composition data in this period." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" innerRadius={58} outerRadius={84} paddingAngle={2} stroke={colors.surface}>
          {rows.map((row, index) => (
            <Cell key={row.name} fill={SLICE[index % SLICE.length]} />
          ))}
        </Pie>
        <Tooltip {...tip(colors)} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function HBarChart({ data, name }: { data: { name: string; value: number }[]; name: string }) {
  const colors = useChartColors();
  const rows = data.filter((row) => row.value > 0).slice(0, 8);
  if (!rows.length) return <ChartEmpty label="No ranking for this period." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={colors.line} horizontal={false} />
        <XAxis type="number" tick={{ fill: colors.muted, fontSize: 11 }} allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={128} tick={{ fill: colors.text, fontSize: 11 }} />
        <Tooltip {...tip(colors)} />
        <Bar dataKey="value" name={name} fill={colors.primary} radius={[0, 4, 4, 0]} barSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HistogramChart({ data }: { data: { name: string; value: number }[] }) {
  const colors = useChartColors();
  if (!data.some((row) => row.value > 0)) return <ChartEmpty label="No recorded reading times in this period." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
        <CartesianGrid stroke={colors.line} vertical={false} />
        <XAxis dataKey="name" tick={{ fill: colors.muted, fontSize: 10 }} interval={0} angle={-24} textAnchor="end" height={56} />
        <YAxis tick={{ fill: colors.muted, fontSize: 11 }} width={36} allowDecimals={false} />
        <Tooltip {...tip(colors)} />
        <Bar dataKey="value" name="Recorded reads" fill={colors.violet} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
