"use client";

import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AttributionFactor } from "@/lib/api";

interface AttributionChartProps {
  data: AttributionFactor[];
  productName: string;
}

const intFmt = new Intl.NumberFormat("id-ID");
const decFmt = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

interface BarTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: AttributionFactor }>;
}

function ShapTooltip({ active, payload }: BarTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  const isUp = item.shap_impact_idr >= 0;
  const formattedImpact = `${isUp ? "+" : "-"}Rp ${intFmt.format(
    Math.abs(item.shap_impact_idr)
  )}/L`;

  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur-sm">
      <p className="text-xs font-semibold text-slate-900">{item.factor}</p>
      <p className="mt-0.5 font-mono text-[11px] text-slate-500">
        Jendela Lag: {item.lag_window} ({item.feature_key})
      </p>
      <div className="mt-2 space-y-1 text-xs">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-600">Kontribusi Global</span>
          <span className="font-mono font-bold text-slate-900">
            {decFmt.format(item.importance_pct)}%
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-600">Dampak SHAP Hari Ini</span>
          <span
            className={`font-mono font-bold ${
              isUp ? "text-rose-600" : "text-emerald-600"
            }`}
          >
            {formattedImpact}
          </span>
        </div>
      </div>
    </div>
  );
}

export function AttributionChart({ data, productName }: AttributionChartProps) {
  const chartData = data.map((item) => {
    const sign = item.shap_impact_idr >= 0 ? "+" : "-";
    return {
      ...item,
      barLabel: `${item.importance_pct.toFixed(1)}% (${sign}Rp${intFmt.format(
        Math.abs(item.shap_impact_idr)
      )})`,
    };
  });

  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-5">
      <div className="mb-4">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">
          Explanatory BI • SHAP TreeExplainer
        </span>
        <h2 className="text-lg font-bold text-slate-900">
          Atribusi Faktor Masa Lampau ({productName})
        </h2>
        <p className="text-xs text-slate-500">
          Bobot pengaruh faktor historis (H−1 s/d H−30 &amp; ESDM 25 Hari)
          beserta dampak moneter (Rp/L). Merah mendorong naik, hijau menahan.
        </p>
      </div>

      <div className="h-[360px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 8, right: 112, left: 6, bottom: 8 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e2e8f0"
              horizontal={false}
            />
            <XAxis
              type="number"
              domain={[
                0,
                (dataMax: number) => Math.ceil((dataMax + 8) / 10) * 10,
              ]}
              tickFormatter={(val: number) => `${val}%`}
              tick={{ fontSize: 11, fill: "#64748b" }}
            />
            <YAxis
              type="category"
              dataKey="factor"
              width={185}
              tick={{ fontSize: 11, fill: "#334155", fontWeight: 500 }}
            />
            <Tooltip content={<ShapTooltip />} />
            <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
            <Bar
              dataKey="importance_pct"
              name="Kontribusi Faktor (%)"
              fill="#e11d48"
              radius={[0, 6, 6, 0]}
              barSize={20}
            >
              {chartData.map((entry) => (
                <Cell
                  key={entry.feature_key}
                  fill={entry.shap_impact_idr >= 0 ? "#e11d48" : "#059669"}
                />
              ))}
              <LabelList
                dataKey="barLabel"
                position="right"
                style={{ fontSize: "10.5px", fontWeight: 600, fill: "#1e293b" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
