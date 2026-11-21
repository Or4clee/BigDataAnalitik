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
    <div className="rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur-sm">
      <div className="mb-1.5 flex items-center justify-between gap-4 border-b border-slate-100 pb-1.5">
        <span className="font-mono text-xs font-semibold text-slate-800">
          {label}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            pt.is_forecast
              ? "bg-amber-100 text-amber-800"
              : pt.horizon === "t0"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-slate-100 text-slate-600"
          }`}
        >
          {pt.horizon === "t0"
            ? "Hari Ini (t₀)"
            : pt.is_forecast
              ? pt.horizon ?? "Proyeksi"
              : "Historis"}
        </span>
      </div>
      <div className="space-y-1 text-xs">
        {pt.official_price !== null && (
          <div className="flex items-center justify-between gap-5">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="h-2 w-2 rounded-full bg-slate-700" />
              Harga Resmi SPBU
            </span>
            <span className="font-mono font-semibold text-slate-900">
              {formatRp(pt.official_price)}
            </span>
          </div>
        )}
        {pt.economic_parity !== null && (
          <div className="flex items-center justify-between gap-5">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="h-2 w-2 rounded-full bg-emerald-600" />
              Keekonomian Harian
            </span>
            <span className="font-mono font-semibold text-emerald-700">
              {formatRp(pt.economic_parity)}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-5">
          <span className="flex items-center gap-1.5 text-slate-600">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            {pt.is_forecast ? "Proyeksi ML" : "Estimasi Model"}
          </span>
          <span className="font-mono font-semibold text-amber-700">
            {formatRp(pt.predicted_price)}
          </span>
        </div>
        {diff !== null && (
          <div className="mt-1 flex items-center justify-between gap-5 border-t border-slate-100 pt-1">
            <span className="text-slate-500">Selisih vs SPBU</span>
            <span
              className={`font-mono font-bold ${
                diff > 0
                  ? "text-rose-600"
                  : diff < 0
                    ? "text-emerald-600"
                    : "text-slate-700"
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
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-7">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
            Predictive Analytics • {metadata.benchmark_label} (
            {metadata.benchmark_ticker})
          </span>
          <h2 className="text-lg font-bold text-slate-900">
            Harga Resmi SPBU vs Keekonomian &amp; Proyeksi{" "}
            {kpi.next_adjustment_date}
          </h2>
          <p className="text-xs text-slate-500">
            Garis tangga menunjukkan harga resmi SPBU (DKI/Jawa), garis solid
            menampilkan keekonomian harian, dan garis putus-putus memproyeksikan
            pergerakan hingga tanggal 1 bulan depan.
          </p>
        </div>
        <div className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right">
          <p className="text-[11px] font-medium text-slate-500">
            Target Tgl {kpi.next_adjustment_date}
          </p>
          <p className="font-mono text-sm font-bold text-slate-900">
            Rp {intFmt.format(kpi.next_month_prediction)}/L
          </p>
        </div>
      </div>

      <div className="h-[360px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 24, right: 16, left: 6, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="date"
              tickFormatter={formatShortDate}
              tick={{ fontSize: 11, fill: "#64748b" }}
              minTickGap={22}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={(val: number) => intFmt.format(val)}
              tick={{ fontSize: 11, fill: "#64748b" }}
              width={60}
            />
            <Tooltip content={<ForecastTooltip />} />
            <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
            <ReferenceLine
              x={metadata.end_date}
              stroke="#334155"
              strokeDasharray="3 3"
              label={{
                value: "Hari Ini (t₀)",
                position: "top",
                fill: "#334155",
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
              stroke="#059669"
              strokeWidth={2.4}
              dot={false}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="forecast_line"
              name={`Proyeksi ML s/d ${kpi.next_adjustment_date}`}
              stroke="#d97706"
              strokeWidth={2.75}
              strokeDasharray="6 4"
              dot={{ r: 3, fill: "#d97706" }}
              activeDot={{ r: 6 }}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
