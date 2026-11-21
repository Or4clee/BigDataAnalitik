"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Database,
  ExternalLink,
  Flame,
  HardDrive,
  RefreshCw,
} from "lucide-react";
import { AttributionChart } from "@/components/AttributionChart";
import { ForecastChart } from "@/components/ForecastChart";
import { KpiCards } from "@/components/KpiCards";
import { WhatIfSimulator } from "@/components/WhatIfSimulator";
import {
  API_BASE_URL,
  PRODUCT_TABS,
  fetchDashboard,
  triggerPipelineSync,
  type DashboardResponse,
  type ProductKey,
} from "@/lib/api";

const intFmt = new Intl.NumberFormat("id-ID");

export default function FuelPulseDashboardPage() {
  const [selectedProduct, setSelectedProduct] =
    useState<ProductKey>("pertamax");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const loadDashboard = useCallback(async (product: ProductKey) => {
    setError(null);
    try {
      const payload = await fetchDashboard(product);
      setData(payload);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Gagal memuat data bersih dari FastAPI / Hadoop HDFS."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void loadDashboard(selectedProduct);
  }, [selectedProduct, loadDashboard]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setSyncNotice(null);
    try {
      const syncRes = await triggerPipelineSync();
      await loadDashboard(selectedProduct);
      setSyncNotice(
        `Pipeline NiFi→HDFS selesai: ${intFmt.format(
          syncRes.raw_hourly_records
        )} baris hourly & ${syncRes.daily_records} hari (${syncRes.start_date} s/d ${
          syncRes.end_date
        }) tersimpan ke ${
          syncRes.hdfs_connected ? "Hadoop HDFS Clean Zone" : "Local Mirror"
        }.`
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Sinkronisasi pipeline gagal."
      );
    } finally {
      setSyncing(false);
    }
  };

  const isHdfsConnected =
    data?.hdfs_status?.connected ||
    (data?.source_storage?.includes("Hadoop HDFS") ?? false);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Top Navigation Bar */}
      <header className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-sm">
                <Flame className="h-5 w-5" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                    FuelPulse BI
                  </h1>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                    Apache NiFi + Hadoop HDFS
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Prediksi Harga BBM Non-Subsidi Pertamina (DKI Jakarta &amp;
                  Pulau Jawa • PPN 11% + PBBKB 5%) &amp; Atribusi SHAP
                </p>
              </div>
            </div>

            {data && (
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-700">
                  <Calendar className="h-3.5 w-3.5 text-emerald-600" />
                  Data Real 365 Hari:{" "}
                  <strong className="font-mono text-slate-900">
                    {data.metadata.date_range}
                  </strong>
                </span>
                <a
                  href={data.hdfs_status.namenode_ui}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-semibold transition ${
                    isHdfsConnected
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                      : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                  }`}
                >
                  <HardDrive className="h-3.5 w-3.5" />
                  {isHdfsConnected
                    ? "Hadoop HDFS Clean Zone: Connected"
                    : "HDFS Offline (Local Fallback)"}
                  <ExternalLink className="h-3 w-3 opacity-70" />
                </a>
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-600">
                  <Database className="h-3.5 w-3.5 text-indigo-600" />
                  {data.source_storage}
                </span>
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw
                className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`}
              />
              {syncing
                ? "Menjalankan Pipeline & HDFS..."
                : "Refresh / Sync Pipeline"}
            </button>
            {data && (
              <span className="font-mono text-[11px] text-slate-500">
                Sinkronisasi terakhir:{" "}
                {new Date(data.metadata.last_synced_at).toLocaleString("id-ID")}
              </span>
            )}
          </div>
        </div>

        {/* 4 Tab Pemilih Produk BBM Non-Subsidi */}
        <nav
          aria-label="Pemilih Produk BBM Non-Subsidi"
          className="mt-5 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4 sm:grid-cols-4"
        >
          {PRODUCT_TABS.map((tab) => {
            const active = selectedProduct === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSelectedProduct(tab.key)}
                className={`flex flex-col items-start rounded-xl border px-3.5 py-2.5 text-left transition ${
                  active
                    ? "border-emerald-600 bg-emerald-50/80 shadow-sm ring-1 ring-emerald-600"
                    : "border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-white"
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span
                    className={`text-sm font-bold ${
                      active ? "text-emerald-900" : "text-slate-800"
                    }`}
                  >
                    {tab.label}
                  </span>
                  <span
                    className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                      active
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {tab.spec}
                  </span>
                </div>
                <span className="mt-1 text-[11px] text-slate-500">
                  Acuan: {tab.benchmark}
                </span>
              </button>
            );
          })}
        </nav>

        {syncNotice && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{syncNotice}</span>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}
      </header>

      {loading && !data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((skeleton) => (
            <div
              key={skeleton}
              className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white p-5"
            />
          ))}
        </div>
      ) : data ? (
        <>
          {/* Baris 1: Executive KPI Cards */}
          <KpiCards kpi={data.kpi} metadata={data.metadata} />

          {/* Baris 2: Main Analytical Charts (Forecast + SHAP Attribution) */}
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <ForecastChart
              data={data.time_series}
              metadata={data.metadata}
              kpi={data.kpi}
            />
            <AttributionChart
              data={data.bi_lag_attribution}
              productName={data.metadata.product_name}
            />
          </section>

          {/* Baris 3: Interactive What-If Simulator + Auto-Insights & Model Comparison */}
          <WhatIfSimulator
            product={selectedProduct}
            metadata={data.metadata}
            insights={data.insights}
            modelComparison={data.model_comparison}
            bestModelName={data.kpi.model_metrics.best_model}
          />

          {/* Footer Arsitektur */}
          <footer className="mt-6 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-xs text-slate-500 shadow-sm">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <span>
                Arsitektur:{" "}
                <strong className="text-slate-700">
                  Apache NiFi 1.28.1 → Hadoop HDFS 3.3.6 (Bronze/Silver/Gold) →
                  FastAPI WebHDFS → Next.js
                </strong>{" "}
                • Formula ESDM (25-Day Window, PPN 11% + PBBKB 5%)
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                API: {API_BASE_URL}
              </span>
            </div>
          </footer>
        </>
      ) : null}
    </main>
  );
}
