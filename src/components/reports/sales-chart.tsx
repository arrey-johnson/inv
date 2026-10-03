"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface SalesChartPoint {
  month: string;
  sales: number;
  paid: number;
}

const compact = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : Math.abs(n) >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n);

/** Monthly sales (excluding VAT, net of credit notes) next to cash received. */
export function SalesChart({ data, currency }: { data: SalesChartPoint[]; currency: string }) {
  return (
    <div className="h-72 w-full" role="img" aria-label={`Monthly sales and payments in ${currency}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis tickFormatter={compact} tickLine={false} axisLine={false} fontSize={12} width={48} />
          <Tooltip formatter={(value) => `${Number(value).toLocaleString("fr-FR")} ${currency}`} />
          <Legend />
          <Bar dataKey="sales" name="Sales (HT)" fill="var(--color-primary, #1d4ed8)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="paid" name="Payments received" fill="var(--color-success, #16a34a)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
