"use client";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const fmt = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(2)} L`;
  return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
};
const C = { green: "#5a8a2a", light: "#a7d174", grey: "#878787", red: "#c0392b", amber: "#d4a017", blue: "#1f6feb", dark: "#7f1d1d" };
export const RISK_COLORS: Record<string, string> = { critical: C.dark, high: C.red, medium: C.amber, low: C.green, opportunity: C.blue };

export function BarsChart({ data, bars, height = 260, stacked }: { data: Record<string, string | number>[]; bars: { key: string; label: string; color?: string }[]; height?: number; stacked?: boolean }) {
  if (!data.length) return <p className="p-6 text-center text-sm text-muted-foreground">No data yet.</p>;
  const palette = [C.green, C.grey, C.red, C.amber, C.blue, C.light];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={fmt} tick={{ fontSize: 11 }} width={70} />
        <Tooltip formatter={(v) => `₹ ${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {bars.map((b, i) => <Bar key={b.key} dataKey={b.key} name={b.label} fill={b.color ?? palette[i % palette.length]} stackId={stacked ? "s" : undefined} radius={stacked ? 0 : [3, 3, 0, 0]} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CountBars({ data, height = 240, colorBy }: { data: { name: string; value: number; key?: string }[]; height?: number; colorBy?: Record<string, string> }) {
  if (!data.length) return <p className="p-6 text-center text-sm text-muted-foreground">No data yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
        <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="value" radius={[0, 3, 3, 0]}>
          {data.map((d, i) => <Cell key={i} fill={(colorBy && d.key && colorBy[d.key]) || C.green} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, height = 220 }: { data: { name: string; value: number; color?: string }[]; height?: number }) {
  if (!data.some((d) => d.value)) return <p className="p-6 text-center text-sm text-muted-foreground">No data yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
          {data.map((d, i) => <Cell key={i} fill={d.color ?? Object.values(C)[i % 7]} />)}
        </Pie>
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
