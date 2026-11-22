"use client";

import React from "react";
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
          badge: "bg-rose-50 text-rose-900 border-rose-700",
          marker: "▲",
          text: "text-rose-700",
        }
      : kpi.status === "TURUN"
        ? {
            badge: "bg-emerald-50 text-emerald-900 border-emerald-700",
            marker: "▼",
            text: "text-emerald-700",
          }
        : {
            badge: "bg-stone-100 text-stone-800 border-stone-500",
            marker: "=",
            text: "text-stone-700",
          };

  return (
    <section
      aria-label="Ringkasan Metrik Utama"
      className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <div className="rounded-lg border border-stone-300 bg-white p-5">
        <p className="text-xs font-semibold text-stone-600">
          Harga Resmi SPBU
        </p>
        <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-stone-900">
          {formatRupiah(kpi.current_official_price)}
          <span className="ml-1 text-xs font-normal text-stone-600">/L</span>
        </p>
        <p className="mt-2 text-xs text-stone-600">
          {metadata.product_name}, {metadata.region}
        </p>
      </div>

      <div className="rounded-lg border border-stone-300 bg-white p-5">
        <p className="text-xs font-semibold text-stone-600">
          Harga Keekonomian Hari Ini
        </p>
        <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-stone-900">
          {formatRupiah(kpi.today_economic_parity)}
          <span className="ml-1 text-xs font-normal text-stone-600">/L</span>
        </p>
        <p className="mt-2 text-xs text-stone-600">
          Selisih vs SPBU:{" "}
          <span
            className={`font-mono font-semibold tabular-nums ${
              kpi.parity_gap_idr > 0
                ? "text-rose-700"
                : kpi.parity_gap_idr < 0
                  ? "text-emerald-700"
                  : "text-stone-700"
            }`}
          >
            {formatSignedRupiah(kpi.parity_gap_idr)}/L
          </span>
        </p>
      </div>

      {/* Focal point card: next-month retail adjustment decision */}
      <div className="rounded-lg border border-stone-300 border-l-4 border-l-petrol-700 bg-white p-5">
        <p className="text-xs font-semibold text-petrol-700">
          Prediksi Tgl {kpi.next_adjustment_date}
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-2.5">
          <p className="font-mono text-2xl font-bold tabular-nums text-stone-900">
            {formatRupiah(kpi.next_month_prediction)}
          </p>
          <span
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-bold ${statusStyles.badge}`}
          >
            <span aria-hidden="true">{statusStyles.marker}</span>
            {kpi.status}
          </span>
        </div>
        <p className="mt-2 text-xs text-stone-600">
          Estimasi penyesuaian:{" "}
          <span
            className={`font-mono font-semibold tabular-nums ${statusStyles.text}`}
          >
            {formatSignedRupiah(kpi.delta_idr)}/L
          </span>
        </p>
      </div>

      <div className="rounded-lg border border-stone-300 bg-white p-5">
        <p className="text-xs font-semibold text-stone-600">
          Performa Model ML
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-2.5">
          <p className="font-mono text-xl font-bold tabular-nums text-stone-900">
            MAE Rp {decFmt.format(kpi.model_metrics.mae_idr)}
          </p>
          <span className="rounded border border-stone-400 bg-stone-100 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-stone-800">
            R² {kpi.model_metrics.r2_score.toFixed(3)}
          </span>
        </div>
        <p className="mt-2 text-xs text-stone-600">
          {kpi.model_metrics.best_model},{" "}
          <span className="font-mono font-semibold tabular-nums text-stone-800">
            {intFmt.format(metadata.raw_hourly_records)}
          </span>{" "}
          baris hourly
        </p>
      </div>
    </section>
  );
}
