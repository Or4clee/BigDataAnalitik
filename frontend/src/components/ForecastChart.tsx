"use client";

import React from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardKpi, DashboardMetadata, ForecastPoint } from "@/lib/api";

interface ForecastChartProps {
  data: ForecastPoint[];
  metadata: DashboardMetadata;
  kpi: DashboardKpi;
}

const intFmt = new Intl.NumberFormat("id-ID");

function formatShortDate(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}`;
}

function formatRp(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return "-";
  return `Rp ${intFmt.format(Math.round(val))}/L`;
}

interface TooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{ payload?: ForecastPoint }>;
}

function ForecastTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  const refPrice = pt.is_forecast ? pt.predicted_price : pt.economic_parity;
  const diff =
    refPrice !== null && pt.official_price !== null
      ? Math.round(refPrice - pt.official_price)
      : null;

  return (
    <div className="rounded-md border border-stone-500 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-4 border-b border-stone-200 pb-1.5">
        <span className="font-mono text-xs font-semibold text-stone-900">
          {label}
        </span>
        <span
          className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
            pt.is_forecast
              ? "border-amber-700 bg-amber-50 text-amber-900"
              : pt.horizon === "t0"
                ? "border-petrol-700 bg-petrol-50 text-petrol-800"
                : "border-stone-400 bg-stone-100 text-stone-800"
          }`}
        >
          {pt.horizon === "t0"
            ? "Hari Ini (t0)"
            : pt.is_forecast
              ? pt.horizon ?? "Proyeksi"
              : "Historis"}
        </span>
      </div>
      <div className="space-y-1 text-xs">
        {pt.official_price !== null && (
          <div className="flex items-center justify-between gap-5">
            <span className="text-stone-700">Harga Resmi SPBU</span>
            <span className="font-mono font-semibold tabular-nums text-stone-900">
              {formatRp(pt.official_price)}
            </span>
          </div>
        )}
        {pt.economic_parity !== null && (
          <div className="flex items-center justify-between gap-5">
            <span className="text-stone-700">Keekonomian Harian</span>
            <span className="font-mono font-semibold tabular-nums text-petrol-800">
              {formatRp(pt.economic_parity)}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-5">
          <span className="text-stone-700">
            {pt.is_forecast ? "Proyeksi ML" : "Estimasi Model"}
          </span>
          <span className="font-mono font-semibold tabular-nums text-amber-800">
            {formatRp(pt.predicted_price)}
          </span>
        </div>
        {diff !== null && (
          <div className="mt-1 flex items-center justify-between gap-5 border-t border-stone-200 pt-1">
            <span className="text-stone-600">Selisih vs SPBU</span>
            <span
              className={`font-mono font-bold tabular-nums ${
                diff > 0
                  ? "text-rose-700"
                  : diff < 0
                    ? "text-emerald-700"
                    : "text-stone-800"
              }`}
            >
              {diff > 0 ? "+" : diff < 0 ? "-" : ""}Rp{" "}
              {intFmt.format(Math.abs(diff))}/L
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function ForecastChart({ data, metadata, kpi }: ForecastChartProps) {
  return (
    <div className="min-w-0 rounded-lg border border-stone-300 bg-white p-5 lg:col-span-7">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-petrol-700">
            Prediksi Harga ({metadata.benchmark_label}, {metadata.benchmark_ticker})
          </p>
          <h2 className="mt-0.5 text-lg font-bold text-stone-900">
            Pergerakan Harga Resmi SPBU vs Keekonomian dan Proyeksi{" "}
            {kpi.next_adjustment_date}
          </h2>
          <p className="mt-1 text-xs text-stone-600">
            Apakah harga keekonomian harian saat ini berada di atas atau di
            bawah harga resmi SPBU?
          </p>
        </div>
        <div className="shrink-0 rounded-md border border-stone-300 bg-stone-50 px-3 py-2 sm:text-right">
          <p className="text-xs font-medium text-stone-600">
            Target Tgl {kpi.next_adjustment_date}
          </p>
          <p className="font-mono text-sm font-bold tabular-nums text-stone-900">
            Rp {intFmt.format(kpi.next_month_prediction)}/L
          </p>
        </div>
      </div>

      <div className="h-[280px] w-full sm:h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 24, right: 14, left: 4, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis
              dataKey="date"
              tickFormatter={formatShortDate}
              tick={{ fontSize: 11, fill: "#44403c" }}
              minTickGap={22}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={(val: number) => intFmt.format(val)}
              tick={{ fontSize: 11, fill: "#44403c" }}
              width={56}
            />
            <Tooltip content={<ForecastTooltip />} />
            <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
            <ReferenceLine
              x={metadata.end_date}
              stroke="#44403c"
              strokeDasharray="3 3"
              label={{
                value: "Hari Ini (t0)",
                position: "top",
                fill: "#1c1917",
                fontSize: 11,
                fontWeight: 600,
              }}
            />
            <Line
              type="stepAfter"
              dataKey="official_price"
              name="Harga Resmi SPBU"
              stroke="#1e293b"
              strokeWidth={2.2}
              dot={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="economic_parity"
              name="Harga Keekonomian Harian"
              stroke="#0e5a6f"
              strokeWidth={2.4}
              dot={false}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="forecast_line"
              name={`Proyeksi ML s/d ${kpi.next_adjustment_date}`}
              stroke="#b45309"
              strokeWidth={2.6}
              strokeDasharray="6 4"
              dot={{ r: 3, fill: "#b45309" }}
              activeDot={{ r: 6 }}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
