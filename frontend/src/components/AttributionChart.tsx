"use client";

import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
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
    <div className="rounded-md border border-stone-500 bg-white p-3">
      <p className="text-xs font-semibold text-stone-900">{item.factor}</p>
      <p className="mt-0.5 font-mono text-[11px] text-stone-600">
        Jendela Lag: {item.lag_window} ({item.feature_key})
      </p>
      <div className="mt-2 space-y-1 text-xs">
        <div className="flex items-center justify-between gap-4">
          <span className="text-stone-700">Kontribusi Global</span>
          <span className="font-mono font-bold tabular-nums text-stone-900">
            {decFmt.format(item.importance_pct)}%
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-stone-700">Dampak SHAP Hari Ini</span>
          <span
            className={`font-mono font-bold tabular-nums ${
              isUp ? "text-rose-700" : "text-emerald-700"
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

  const maxPct = Math.max(...chartData.map((d) => d.importance_pct), 1);

  return (
    <div className="min-w-0 rounded-lg border border-stone-300 bg-white p-5 lg:col-span-5">
      <div className="mb-3">
        <p className="text-xs font-semibold text-petrol-700">
          Atribusi SHAP TreeExplainer ({productName})
        </p>
        <h2 className="mt-0.5 text-lg font-bold text-stone-900">
          Faktor Historis yang Mendorong Harga Hari Ini
        </h2>
        <p className="mt-1 text-xs text-stone-600">
          Variabel masa lampau mana (H-1 hingga H-30) yang mendorong kenaikan
          atau menahan harga?
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-4 border-b border-stone-200 pb-2 text-xs text-stone-700">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-700"
          />
          Mendorong naik (+Rp/L)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-700"
          />
          Menahan harga (-Rp/L)
        </span>
      </div>

      {/* Desktop and tablet horizontal chart */}
      <div className="hidden h-[320px] w-full sm:block">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 112, left: 4, bottom: 4 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e7e5e4"
              horizontal={false}
            />
            <XAxis
              type="number"
              domain={[
                0,
                (dataMax: number) => Math.ceil((dataMax + 8) / 10) * 10,
              ]}
              tickFormatter={(val: number) => `${val}%`}
              tick={{ fontSize: 11, fill: "#44403c" }}
            />
            <YAxis
              type="category"
              dataKey="factor"
              width={185}
              tick={{ fontSize: 11, fill: "#1c1917", fontWeight: 500 }}
            />
            <Tooltip content={<ShapTooltip />} />
            <Bar
              dataKey="importance_pct"
              name="Kontribusi Faktor (%)"
              fill="#be123c"
              radius={[0, 4, 4, 0]}
              barSize={20}
            >
              {chartData.map((entry) => (
                <Cell
                  key={entry.feature_key}
                  fill={entry.shap_impact_idr >= 0 ? "#be123c" : "#047857"}
                />
              ))}
              <LabelList
                dataKey="barLabel"
                position="right"
                style={{ fontSize: "11px", fontWeight: 600, fill: "#1c1917" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Mobile reflow list so factor labels never clip on narrow viewports */}
      <ul className="space-y-3 sm:hidden">
        {chartData.map((item) => {
          const isUp = item.shap_impact_idr >= 0;
          const barWidth = Math.max(8, Math.round((item.importance_pct / maxPct) * 100));
          return (
            <li
              key={item.feature_key}
              className="rounded border border-stone-200 bg-stone-50 p-3"
            >
              <div className="flex items-start justify-between gap-2 text-xs">
                <span className="font-semibold text-stone-900">
                  {item.factor}
                </span>
                <span
                  className={`shrink-0 font-mono font-bold tabular-nums ${
                    isUp ? "text-rose-700" : "text-emerald-700"
                  }`}
                >
                  {item.barLabel}
                </span>
              </div>
              <div className="mt-2 h-2 w-full rounded bg-stone-200">
                <div
                  className={`h-2 rounded ${
                    isUp ? "bg-rose-700" : "bg-emerald-700"
                  }`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
