"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { AttributionChart } from "@/components/AttributionChart";
import { ForecastChart } from "@/components/ForecastChart";
import { KpiCards } from "@/components/KpiCards";
import { RegionalPbbkbTable } from "@/components/RegionalPbbkbTable";
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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const loadDashboard = useCallback(async (product: ProductKey) => {
    setError(null);
    try {
      const payload = await fetchDashboard(product);
      setData(payload);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Gagal membaca data bersih dari FastAPI atau Hadoop HDFS."
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
        `Pipeline NiFi dan HDFS selesai: ${intFmt.format(
          syncRes.raw_hourly_records
        )} baris hourly dan ${syncRes.daily_records} hari (${syncRes.start_date} s/d ${
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

  const handleTabKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    idx: number
  ) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const nextIdx =
      e.key === "ArrowRight"
        ? (idx + 1) % PRODUCT_TABS.length
        : (idx - 1 + PRODUCT_TABS.length) % PRODUCT_TABS.length;
    setSelectedProduct(PRODUCT_TABS[nextIdx].key);
    tabRefs.current[nextIdx]?.focus();
  };

  const isHdfsConnected =
    data?.hdfs_status?.connected ||
    (data?.source_storage?.includes("Hadoop HDFS") ?? false);

  const isEmptyDataset =
    !loading &&
    !error &&
    data !== null &&
    (data.time_series.length === 0 || data.bi_lag_attribution.length === 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 rounded-lg border border-stone-300 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
              FuelPulse BI
            </h1>
            <p className="text-sm text-stone-700">
              Prediksi harga BBM Non-Subsidi Pertamina (DKI Jakarta dan Pulau
              Jawa, PPN 11% + PBBKB 5%) berbasis Apache NiFi, Hadoop HDFS, dan
              atribusi SHAP.
            </p>

            {data && (
              <div className="flex flex-wrap items-center gap-2.5 pt-1 text-xs">
                <span className="inline-flex min-h-[36px] items-center rounded border border-stone-300 bg-stone-50 px-2.5 py-1 text-stone-700">
                  Data Real 365 Hari:{" "}
                  <strong className="ml-1 font-mono text-stone-900">
                    {data.metadata.date_range}
                  </strong>
                </span>
                <span className="inline-flex min-h-[36px] items-center rounded border border-stone-300 bg-stone-50 px-2.5 py-1 text-stone-700">
                  Volume Big Data:{" "}
                  <strong className="ml-1 font-mono text-stone-900">
                    {intFmt.format(data.metadata.raw_hourly_records)} baris riil
                  </strong>
                </span>
                <a
                  href={data.hdfs_status.namenode_ui}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-md border px-3 py-1.5 font-semibold transition ${
                    isHdfsConnected
                      ? "border-emerald-700 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                      : "border-amber-700 bg-amber-50 text-amber-900 hover:bg-amber-100"
                  }`}
                >
                  <span>
                    {isHdfsConnected
                      ? "Hadoop HDFS Clean Zone: Terhubung"
                      : "HDFS Offline (Local Fallback)"}
                  </span>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
                <span className="inline-flex min-h-[36px] items-center rounded border border-stone-300 bg-stone-50 px-2.5 py-1 text-stone-700">
                  Sumber: {data.source_storage}
                </span>
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-petrol-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-petrol-800 active:bg-petrol-900 disabled:opacity-60"
            >
              <RefreshCw
                className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {syncing
                ? "Menjalankan Pipeline ke HDFS..."
                : "Sinkronisasi Pipeline HDFS"}
            </button>
            {data && (
              <span className="font-mono text-xs text-stone-600">
                Sinkronisasi terakhir:{" "}
                {new Date(data.metadata.last_synced_at).toLocaleString("id-ID")}
              </span>
            )}
          </div>
        </div>

        <nav
          aria-label="Pemilih Produk BBM Non-Subsidi"
          role="tablist"
          className="mt-5 grid grid-cols-1 gap-2.5 border-t border-stone-200 pt-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {PRODUCT_TABS.map((tab, idx) => {
            const active = selectedProduct === tab.key;
            return (
              <button
                key={tab.key}
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="fuelpulse-panel"
                onClick={() => setSelectedProduct(tab.key)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                className={`flex min-h-[56px] flex-col items-start rounded-md border px-3.5 py-2.5 text-left transition ${
                  active
                    ? "border-2 border-petrol-700 bg-petrol-50"
                    : "border-stone-500 bg-white hover:bg-stone-50 active:bg-stone-100"
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span
                    className={`text-sm font-bold ${
                      active ? "text-petrol-900" : "text-stone-900"
                    }`}
                  >
                    {tab.label}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
                      active
                        ? "bg-petrol-700 text-white"
                        : "bg-stone-200 text-stone-800"
                    }`}
                  >
                    {tab.spec}
                  </span>
                </div>
                <span className="mt-1 text-xs text-stone-600">
                  Acuan: {tab.benchmark}
                </span>
              </button>
            );
          })}
        </nav>

        {syncNotice && (
          <div
            role="status"
            aria-live="polite"
            className="mt-4 rounded-md border border-emerald-700 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-900"
          >
            {syncNotice}
          </div>
        )}
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        aria-live="polite"
        className="outline-none"
      >
        {loading && !data ? (
          <section
            role="status"
            aria-label="Status Pemuatan Data"
            className="rounded-lg border border-stone-300 bg-white p-6"
          >
            <p className="text-sm font-semibold text-stone-900">
              Memuat ringkasan harga BBM, proyeksi model, dan atribusi SHAP dari
              Hadoop HDFS...
            </p>
            <p className="mt-1 text-xs text-stone-600">
              Mengambil data bersih dari /fuelpulse/gold_clean_analytics melalui
              FastAPI.
            </p>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[1, 2, 3, 4].map((item) => (
                <div
                  key={item}
                  className="h-24 rounded border border-stone-200 bg-stone-100 p-4"
                />
              ))}
            </div>
          </section>
        ) : error ? (
          <section
            role="alert"
            className="rounded-lg border border-rose-700 bg-rose-50 p-6"
          >
            <h2 className="text-base font-bold text-rose-900">
              Gagal Memuat Data Dashboard
            </h2>
            <p className="mt-1 text-xs text-rose-900">{error}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  void loadDashboard(selectedProduct);
                }}
                className="min-h-[44px] rounded-md border border-rose-700 bg-white px-4 py-2 text-xs font-semibold text-rose-900 hover:bg-rose-100"
              >
                Muat Ulang Dashboard
              </button>
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing}
                className="min-h-[44px] rounded-md bg-petrol-700 px-4 py-2 text-xs font-semibold text-white hover:bg-petrol-800 disabled:opacity-60"
              >
                Jalankan Sinkronisasi Pipeline
              </button>
            </div>
          </section>
        ) : isEmptyDataset ? (
          <section className="rounded-lg border border-stone-300 bg-white p-6">
            <h2 className="text-base font-bold text-stone-900">
              Data Analisis Belum Tersedia di HDFS Clean Zone
            </h2>
            <p className="mt-1 text-xs text-stone-600">
              Deret waktu prediksi atau atribusi SHAP untuk produk ini masih
              kosong. Jalankan sinkronisasi pipeline untuk memproses data real
              365 hari ke Hadoop HDFS.
            </p>
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="mt-4 min-h-[44px] rounded-md bg-petrol-700 px-4 py-2 text-xs font-semibold text-white hover:bg-petrol-800 disabled:opacity-60"
            >
              {syncing
                ? "Menjalankan Pipeline..."
                : "Jalankan Sinkronisasi Pipeline"}
            </button>
          </section>
        ) : data ? (
          <div id="fuelpulse-panel" role="tabpanel">
            <KpiCards kpi={data.kpi} metadata={data.metadata} />

            <section
              aria-label="Grafik Prediksi dan Atribusi SHAP"
              className="grid grid-cols-1 gap-6 lg:grid-cols-12"
            >
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

            <WhatIfSimulator
              product={selectedProduct}
              metadata={data.metadata}
              insights={data.insights}
              modelComparison={data.model_comparison}
              bestModelName={data.kpi.model_metrics.best_model}
            />

            <RegionalPbbkbTable
              rows={data.regional_prices ?? []}
              productName={data.metadata.product_name}
              nextAdjustmentDate={data.kpi.next_adjustment_date}
              bronzeBreakdown={data.metadata.bronze_breakdown}
            />

            <footer className="mt-6 rounded-lg border border-stone-300 bg-white px-5 py-3.5 text-xs text-stone-700">
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <span>
                  Arsitektur:{" "}
                  <strong className="text-stone-900">
                    Apache NiFi 1.28.1, Hadoop HDFS 3.3.6, Apache Spark 3.5.1,
                    FastAPI WebHDFS, Next.js
                  </strong>{" "}
                  | Formula ESDM (25-Day Window, PPN 11% + PBBKB 5%-10%)
                </span>
                <span className="font-mono text-xs text-stone-600">
                  API: {API_BASE_URL}
                </span>
              </div>
            </footer>
          </div>
        ) : null}
      </main>
    </div>
  );
}
