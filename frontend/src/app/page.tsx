"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  Calendar,
  CheckCircle2,
  Database,
  Layers,
  MapPin,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface DashboardMetadata {
  product_name: string;
  region: string;
  target_symbol: string;
  start_date: string;
  end_date: string;
  forecast_end_date: string;
  hourly_weather_records: number;
  daily_records: number;
  train_records: number;
  test_records: number;
  dominant_factor: string;
  dominant_factor_pct: number;
  mae: number;
  rmse: number;
  last_synced_at: string;
  cache_source: string;
}

interface AttributionItem {
  factor: string;
  feature_key: string;
  importance_pct: number;
}

interface TimeSeriesPoint {
  date: string;
  actual: number | null;
  predicted: number;
  actual_line: number | null;
  forecast_line: number | null;
  is_forecast: boolean;
  horizon: string | null;
  backtest_line?: number | null;
}

interface DashboardResponse {
  metadata: DashboardMetadata;
  bi_lag_attribution: AttributionItem[];
  time_series: TimeSeriesPoint[];
}

interface SyncResponse {
  status: string;
  message: string;
  rows_processed: number;
  hourly_weather_records: number;
  start_date: string;
  end_date: string;
  synced_at: string;
}

const numberFormatter = new Intl.NumberFormat("id-ID");
const decimalFormatter = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatShortDate(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}`;
}

function formatIndexValue(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return "-";
  return `Rp ${numberFormatter.format(Math.round(val))}`;
}

interface LineTooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{
    payload?: TimeSeriesPoint;
  }>;
}

function PredictiveTooltip({ active, payload, label }: LineTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur-sm">
      <div className="mb-1.5 flex items-center justify-between gap-4 border-b border-slate-100 pb-1.5">
        <span className="font-mono text-xs font-semibold text-slate-800">
          {label}
        </span>
        {point.horizon ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              point.is_forecast
                ? "bg-amber-100 text-amber-800"
                : "bg-emerald-100 text-emerald-800"
            }`}
          >
            {point.horizon === "t0" ? "Hari Ini (t₀)" : point.horizon}
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
            Historis
          </span>
        )}
      </div>
      <div className="space-y-1 text-xs">
        {point.actual !== null && (
          <div className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="h-2 w-2 rounded-full bg-emerald-600" />
              Aktual (ICBP.JK)
            </span>
            <span className="font-mono font-semibold text-slate-900">
              {formatIndexValue(point.actual)}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-1.5 text-slate-600">
            <span
              className={`h-2 w-2 rounded-full ${
                point.is_forecast ? "bg-amber-500" : "bg-indigo-500"
              }`}
            />
            {point.is_forecast ? "Proyeksi ML" : "Estimasi Model"}
          </span>
          <span className="font-mono font-semibold text-slate-900">
            {formatIndexValue(point.predicted)}
          </span>
        </div>
      </div>
    </div>
  );
}

interface BarTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload?: AttributionItem;
  }>;
}

function AttributionTooltip({ active, payload }: BarTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur-sm">
      <p className="text-xs font-semibold text-slate-900">{item.factor}</p>
      <p className="mt-0.5 font-mono text-[11px] text-slate-500">
        Fitur: {item.feature_key}
      </p>
      <p className="mt-1.5 text-xs text-slate-700">
        Bobot Kontribusi:{" "}
        <span className="font-mono font-bold text-emerald-700">
          {decimalFormatter.format(item.importance_pct)}%
        </span>
      </p>
    </div>
  );
}

const BAR_COLORS = [
  "#059669",
  "#0d9488",
  "#0284c7",
  "#2563eb",
  "#4f46e5",
  "#64748b",
  "#64748b",
  "#94a3b8",
];

export default function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/dashboard`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errBody}`);
      }
      const payload: DashboardResponse = await response.json();
      setData(payload);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Gagal menghubungi server backend FastAPI."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleSyncPipeline = async () => {
    setSyncing(true);
    setError(null);
    setSyncNotice(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/pipeline/sync`, {
        method: "POST",
      });
      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Sinkronisasi gagal (HTTP ${response.status}): ${errBody}`);
      }
      const syncResult: SyncResponse = await response.json();
      await loadDashboard();
      setSyncNotice(
        `Berhasil menarik ${numberFormatter.format(
          syncResult.hourly_weather_records
        )} record cuaca per-jam & ${syncResult.rows_processed} hari (${
          syncResult.start_date
        } s/d ${syncResult.end_date}).`
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Sinkronisasi data eksternal gagal."
      );
    } finally {
      setSyncing(false);
    }
  };

  const chartSeries = useMemo(() => {
    if (!data) return [];
    return data.time_series.map((point) => ({
      ...point,
      backtest_line: point.is_forecast ? null : point.predicted,
    }));
  }, [data]);

  const forecastSummary = useMemo(() => {
    if (!data) return null;
    const actualPoints = data.time_series.filter((p) => !p.is_forecast && p.actual !== null);
    const futurePoints = data.time_series.filter((p) => p.is_forecast);
    if (actualPoints.length === 0 || futurePoints.length === 0) return null;

    const latestActual = actualPoints[actualPoints.length - 1].actual ?? 0;
    const h7Forecast = futurePoints[futurePoints.length - 1].predicted;
    const deltaPct =
      latestActual > 0 ? ((h7Forecast - latestActual) / latestActual) * 100 : 0;

    return {
      latestActual,
      h7Forecast,
      deltaPct,
    };
  }, [data]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header & Indikator Rentang Data */}
      <header className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                <Activity className="h-5 w-5" />
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                MacroAgri-BI Pulse
              </h1>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                Big Data &amp; ML Analytics
              </span>
            </div>
            <p className="max-w-3xl text-sm text-slate-600">
              Integrasi observasi cuaca per-jam (Open-Meteo) dan indikator pasar
              makroekonomi harian (Yahoo Finance) untuk atribusi faktor masa lampau
              (H−1 s/d H−14) serta peramalan indeks komoditas pangan{" "}
              <span className="font-mono font-semibold text-slate-800">
                ICBP.JK
              </span>{" "}
              7 hari ke depan.
            </p>
            {data && (
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-700">
                  <Calendar className="h-3.5 w-3.5 text-emerald-600" />
                  Rentang Dataset:{" "}
                  <strong className="font-mono text-slate-900">
                    {data.metadata.start_date} s/d {data.metadata.end_date}
                  </strong>
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 font-medium text-amber-800">
                  <TrendingUp className="h-3.5 w-3.5 text-amber-600" />
                  Proyeksi H+7 s/d{" "}
                  <strong className="font-mono">
                    {data.metadata.forecast_end_date}
                  </strong>
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-600">
                  <MapPin className="h-3.5 w-3.5 text-sky-600" />
                  {data.metadata.region}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-600">
                  <Database className="h-3.5 w-3.5 text-indigo-600" />
                  Sumber:{" "}
                  {data.metadata.cache_source === "parquet"
                    ? "Cache Apache Parquet"
                    : "Sinkronisasi Langsung"}
                </span>
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <button
              type="button"
              onClick={handleSyncPipeline}
              disabled={syncing || loading}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw
                className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`}
              />
              {syncing ? "Menarik Data 365 Hari..." : "Sinkronisasi Data API"}
            </button>
            {data && (
              <span className="font-mono text-[11px] text-slate-500">
                Terakhir diperbarui:{" "}
                {new Date(data.metadata.last_synced_at).toLocaleString("id-ID")}
              </span>
            )}
          </div>
        </div>

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
          {/* Baris Kartu KPI (4 Kolom) */}
          <section
            aria-label="Ringkasan KPI"
            className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            {/* KPI 1: Total Record Cuaca Per-Jam */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Total Record Cuaca
                </span>
                <span className="rounded-lg bg-sky-50 p-2 text-sky-600">
                  <Database className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-3 font-mono text-2xl font-bold text-slate-900">
                {numberFormatter.format(data.metadata.hourly_weather_records)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Baris observasi per-jam ({data.metadata.daily_records} hari di
                Parquet)
              </p>
            </div>

            {/* KPI 2: Faktor Dominan Hari Lampau */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Faktor Dominan Historis
                </span>
                <span className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
                  <BarChart3 className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-3 line-clamp-1 text-lg font-bold text-slate-900">
                {data.metadata.dominant_factor}
              </p>
              <p className="mt-1.5 text-xs text-slate-500">
                Kontribusi pengaruh tertinggi:{" "}
                <span className="font-mono font-bold text-emerald-700">
                  {decimalFormatter.format(data.metadata.dominant_factor_pct)}%
                </span>
              </p>
            </div>

            {/* KPI 3: Akurasi Model (MAE) */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Mean Absolute Error (MAE)
                </span>
                <span className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
                  <Layers className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-3 font-mono text-2xl font-bold text-slate-900">
                {decimalFormatter.format(data.metadata.mae)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Rata-rata selisih absolut ({data.metadata.test_records} hari uji)
              </p>
            </div>

            {/* KPI 4: Root Mean Squared Error (RMSE) */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Root Mean Squared Error
                </span>
                <span className="rounded-lg bg-amber-50 p-2 text-amber-600">
                  <TrendingUp className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-3 font-mono text-2xl font-bold text-slate-900">
                {decimalFormatter.format(data.metadata.rmse)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Simpangan error (RMSE) pada pembagian uji 15%
              </p>
            </div>
          </section>

          {/* Grid Utama: Panel Kiri (Predictive H+7) & Panel Kanan (Explanatory BI) */}
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Panel Grafik Kiri — Predictive Analytics (LineChart) */}
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-7">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                    Predictive Analytics (Random Forest)
                  </span>
                  <h2 className="text-lg font-bold text-slate-900">
                    Tren 30 Hari Aktual &amp; Proyeksi H+7 (ICBP.JK)
                  </h2>
                  <p className="text-xs text-slate-500">
                    Garis solid menunjukkan indeks aktual 30 hari terakhir; garis
                    putus-putus menampilkan proyeksi model hingga H+7.
                  </p>
                </div>
                {forecastSummary && (
                  <div className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right">
                    <p className="text-[11px] font-medium text-slate-500">
                      Proyeksi H+7 ({data.metadata.forecast_end_date})
                    </p>
                    <p className="font-mono text-sm font-bold text-slate-900">
                      {formatIndexValue(forecastSummary.h7Forecast)}{" "}
                      <span
                        className={`text-xs font-semibold ${
                          forecastSummary.deltaPct >= 0
                            ? "text-emerald-600"
                            : "text-rose-600"
                        }`}
                      >
                        ({forecastSummary.deltaPct >= 0 ? "+" : ""}
                        {decimalFormatter.format(forecastSummary.deltaPct)}%)
                      </span>
                    </p>
                  </div>
                )}
              </div>

              <div className="h-[360px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartSeries}
                    margin={{ top: 24, right: 16, left: 6, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatShortDate}
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      minTickGap={18}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      tickFormatter={(val: number) =>
                        numberFormatter.format(val)
                      }
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      width={58}
                    />
                    <Tooltip content={<PredictiveTooltip />} />
                    <Legend
                      wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                    />
                    <ReferenceLine
                      x={data.metadata.end_date}
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
                      type="monotone"
                      dataKey="actual_line"
                      name="Aktual 30 Hari"
                      stroke="#059669"
                      strokeWidth={2.5}
                      dot={{ r: 2.5, fill: "#059669" }}
                      activeDot={{ r: 5 }}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="backtest_line"
                      name="Estimasi Model (Uji)"
                      stroke="#6366f1"
                      strokeWidth={1.6}
                      strokeDasharray="2 3"
                      dot={false}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="forecast_line"
                      name="Proyeksi ML (H+1 s/d H+7)"
                      stroke="#d97706"
                      strokeWidth={2.75}
                      strokeDasharray="6 4"
                      dot={{ r: 3.5, fill: "#d97706" }}
                      activeDot={{ r: 6 }}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Panel Grafik Kanan — Business Intelligence Attribution (BarChart Horizontal) */}
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-5">
              <div className="mb-4">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">
                  Explanatory Business Intelligence
                </span>
                <h2 className="text-lg font-bold text-slate-900">
                  Atribusi 8 Faktor Historis Teratas
                </h2>
                <p className="text-xs text-slate-500">
                  Persentase pengaruh variabel masa lampau (H−1 s/d H−14 &amp;
                  rolling 7 hari) terhadap nilai indeks hari ini.
                </p>
              </div>

              <div className="h-[360px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.bi_lag_attribution}
                    layout="vertical"
                    margin={{ top: 8, right: 44, left: 6, bottom: 8 }}
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
                      width={195}
                      tick={{ fontSize: 11, fill: "#334155", fontWeight: 500 }}
                    />
                    <Tooltip content={<AttributionTooltip />} />
                    <Legend
                      wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                    />
                    <Bar
                      dataKey="importance_pct"
                      name="Bobot Pengaruh (%)"
                      fill="#059669"
                      radius={[0, 6, 6, 0]}
                      barSize={22}
                    >
                      {data.bi_lag_attribution.map((entry, idx) => (
                        <Cell
                          key={entry.feature_key}
                          fill={BAR_COLORS[idx % BAR_COLORS.length]}
                        />
                      ))}
                      <LabelList
                        dataKey="importance_pct"
                        position="right"
                        formatter={(val) => `${val}%`}
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          fill: "#1e293b",
                        }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {/* Footer Metodologi & Reproduksibilitas */}
          <footer className="mt-6 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-xs text-slate-500 shadow-sm">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <span>
                Model:{" "}
                <strong className="text-slate-700">
                  RandomForestRegressor (n_estimators=200, random_state=42)
                </strong>{" "}
                • Pembagian Kronologis: {data.metadata.train_records} Latih (85%)
                / {data.metadata.test_records} Uji (15%) • Bebas Kebocoran Data
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
