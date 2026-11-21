"use client";

import React from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Cpu,
  Fuel,
  Minus,
  Scale,
  TrendingUp,
} from "lucide-react";
import type { DashboardKpi, DashboardMetadata } from "@/lib/api";

interface KpiCardsProps {
  kpi: DashboardKpi;
  metadata: DashboardMetadata;
}

const intFmt = new Intl.NumberFormat("id-ID");
const decFmt = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatRupiah(val: number): string {
  return `Rp ${intFmt.format(Math.round(val))}`;
}

function formatSignedRupiah(val: number): string {
  const sign = val > 0 ? "+" : val < 0 ? "-" : "";
  return `${sign}Rp ${intFmt.format(Math.abs(Math.round(val)))}`;
}

export function KpiCards({ kpi, metadata }: KpiCardsProps) {
  const statusStyles =
    kpi.status === "NAIK"
      ? {
          badge: "bg-rose-100 text-rose-800 border-rose-200",
          icon: <ArrowUpRight className="h-3.5 w-3.5" />,
          text: "text-rose-700",
        }
      : kpi.status === "TURUN"
        ? {
            badge: "bg-emerald-100 text-emerald-800 border-emerald-200",
            icon: <ArrowDownRight className="h-3.5 w-3.5" />,
            text: "text-emerald-700",
          }
        : {
            badge: "bg-slate-100 text-slate-700 border-slate-200",
            icon: <Minus className="h-3.5 w-3.5" />,
            text: "text-slate-700",
          };

  return (
    <section
      aria-label="Executive KPI Cards"
      className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {/* Card 1: Harga Resmi SPBU Saat Ini */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Harga Resmi SPBU
          </span>
          <span className="rounded-lg bg-slate-100 p-2 text-slate-700">
            <Fuel className="h-4 w-4" />
          </span>
        </div>
        <p className="mt-3 font-mono text-2xl font-bold text-slate-900">
          {formatRupiah(kpi.current_official_price)}
          <span className="ml-1 text-xs font-normal text-slate-500">/L</span>
        </p>
        <p className="mt-1.5 text-xs text-slate-500">
          {metadata.product_name} • {metadata.region}
        </p>
      </div>

      {/* Card 2: Estimasi Harga Keekonomian Hari Ini */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Harga Keekonomian Hari Ini
          </span>
          <span className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
            <Scale className="h-4 w-4" />
          </span>
        </div>
        <p className="mt-3 font-mono text-2xl font-bold text-slate-900">
          {formatRupiah(kpi.today_economic_parity)}
          <span className="ml-1 text-xs font-normal text-slate-500">/L</span>
        </p>
        <p className="mt-1.5 text-xs text-slate-500">
          Selisih vs SPBU:{" "}
          <span
            className={`font-mono font-semibold ${
              kpi.parity_gap_idr > 0
                ? "text-rose-600"
                : kpi.parity_gap_idr < 0
                  ? "text-emerald-600"
                  : "text-slate-700"
            }`}
          >
            {formatSignedRupiah(kpi.parity_gap_idr)}/L
          </span>
        </p>
      </div>

      {/* Card 3: Prediksi Harga Tanggal 1 Bulan Depan */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Prediksi Tgl {kpi.next_adjustment_date}
          </span>
          <span className="rounded-lg bg-amber-50 p-2 text-amber-600">
            <TrendingUp className="h-4 w-4" />
          </span>
        </div>
        <div className="mt-3 flex items-baseline gap-2.5">
          <p className="font-mono text-2xl font-bold text-slate-900">
            {formatRupiah(kpi.next_month_prediction)}
          </p>
          <span
            className={`inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusStyles.badge}`}
          >
            {statusStyles.icon}
            {kpi.status}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          Estimasi perubahan:{" "}
          <span className={`font-mono font-semibold ${statusStyles.text}`}>
            {formatSignedRupiah(kpi.delta_idr)}/L
          </span>
        </p>
      </div>

      {/* Card 4: Performa Model ML & Total Baris Hourly */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Performa Model ML
          </span>
          <span className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
            <Cpu className="h-4 w-4" />
          </span>
        </div>
        <div className="mt-3 flex items-baseline gap-3">
          <p className="font-mono text-xl font-bold text-slate-900">
            MAE Rp {decFmt.format(kpi.model_metrics.mae_idr)}
          </p>
          <span className="rounded-md bg-indigo-50 px-2 py-0.5 font-mono text-xs font-semibold text-indigo-700">
            R² {kpi.model_metrics.r2_score.toFixed(3)}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          {kpi.model_metrics.best_model} •{" "}
          <span className="font-mono font-semibold text-slate-700">
            {intFmt.format(metadata.raw_hourly_records)}
          </span>{" "}
          baris hourly
        </p>
      </div>
    </section>
  );
}
