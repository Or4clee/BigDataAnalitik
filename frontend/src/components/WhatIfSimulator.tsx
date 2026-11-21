"use client";

import React, { useEffect, useState } from "react";
import {
  Award,
  CheckCircle2,
  Lightbulb,
  RotateCcw,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import {
  runWhatIfSimulation,
  type DashboardMetadata,
  type ModelComparisonRow,
  type ProductKey,
  type SimulateResponse,
} from "@/lib/api";

interface WhatIfSimulatorProps {
  product: ProductKey;
  metadata: DashboardMetadata;
  insights: string[];
  modelComparison: ModelComparisonRow[];
  bestModelName: string;
}

const intFmt = new Intl.NumberFormat("id-ID");
const USD_MIN = 14500;
const USD_MAX = 19500;
const BRENT_MIN = 55;
const BRENT_MAX = 120;

export function WhatIfSimulator({
  product,
  metadata,
  insights,
  modelComparison,
  bestModelName,
}: WhatIfSimulatorProps) {
  const defaultUsd = Math.min(
    USD_MAX,
    Math.max(USD_MIN, Math.round(metadata.latest_usd_idr / 50) * 50)
  );
  const defaultBrent = Math.min(
    BRENT_MAX,
    Math.max(BRENT_MIN, Math.round(metadata.latest_brent_usd * 2) / 2)
  );

  const [usdIdr, setUsdIdr] = useState<number>(defaultUsd);
  const [brentUsd, setBrentUsd] = useState<number>(defaultBrent);
  const [simResult, setSimResult] = useState<SimulateResponse | null>(null);
  const [simLoading, setSimLoading] = useState<boolean>(false);
  const [simError, setSimError] = useState<string | null>(null);

  useEffect(() => {
    setUsdIdr(defaultUsd);
    setBrentUsd(defaultBrent);
  }, [product, defaultUsd, defaultBrent]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setSimLoading(true);
      setSimError(null);
      try {
        const res = await runWhatIfSimulation({
          product,
          usd_idr: usdIdr,
          brent_usd: brentUsd,
        });
        if (active) setSimResult(res);
      } catch (err) {
        if (active) {
          setSimError(
            err instanceof Error ? err.message : "Gagal menjalankan simulasi."
          );
        }
      } finally {
        if (active) setSimLoading(false);
      }
    }, 120);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [product, usdIdr, brentUsd]);

  const handleReset = () => {
    setUsdIdr(defaultUsd);
    setBrentUsd(defaultBrent);
  };

  return (
    <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Kiri: Interactive What-If Scenario Simulator */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-amber-700">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              What-If Scenario Simulator
            </span>
            <h2 className="text-lg font-bold text-slate-900">
              Simulasi Sensitivitas Kurs &amp; Minyak Brent
            </h2>
            <p className="text-xs text-slate-500">
              Geser slider asumsi makro untuk melihat inferensi ulang harga{" "}
              <strong className="text-slate-700">{metadata.product_name}</strong>{" "}
              secara instan (&lt;500 ms).
            </p>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>

        <div className="space-y-5">
          {/* Slider 1: Kurs USD/IDR */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <label
                htmlFor="slider-usd-idr"
                className="font-semibold text-slate-700"
              >
                Asumsi Kurs USD/IDR
              </label>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono font-bold text-slate-900">
                Rp {intFmt.format(usdIdr)}
              </span>
            </div>
            <input
              id="slider-usd-idr"
              type="range"
              min={USD_MIN}
              max={USD_MAX}
              step={50}
              value={usdIdr}
              onChange={(e) => setUsdIdr(Number(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-emerald-600"
            />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-400">
              <span>Rp 14.500</span>
              <span>Saat Ini: Rp {intFmt.format(Math.round(metadata.latest_usd_idr))}</span>
              <span>Rp 19.500</span>
            </div>
          </div>

          {/* Slider 2: Brent Crude */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <label
                htmlFor="slider-brent"
                className="font-semibold text-slate-700"
              >
                Asumsi Minyak Mentah Brent
              </label>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono font-bold text-slate-900">
                ${brentUsd.toFixed(1)} / barel
              </span>
            </div>
            <input
              id="slider-brent"
              type="range"
              min={BRENT_MIN}
              max={BRENT_MAX}
              step={0.5}
              value={brentUsd}
              onChange={(e) => setBrentUsd(Number(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-amber-600"
            />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-400">
              <span>$55/bbl</span>
              <span>Saat Ini: ${metadata.latest_brent_usd.toFixed(1)}/bbl</span>
              <span>$120/bbl</span>
            </div>
          </div>
        </div>

        {/* Simulation Output Box */}
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
          {simError ? (
            <p className="text-xs text-rose-600">{simError}</p>
          ) : simResult ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-medium text-slate-500">
                    Estimasi Harga Ritel Simulasi (Terbulatkan)
                  </p>
                  <p className="mt-0.5 font-mono text-2xl font-bold text-slate-900">
                    Rp {intFmt.format(simResult.simulated_retail_price)}
                    <span className="ml-1 text-xs font-normal text-slate-500">
                      /L
                    </span>
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-bold ${
                    simResult.status === "NAIK"
                      ? "border-rose-200 bg-rose-100 text-rose-800"
                      : simResult.status === "TURUN"
                        ? "border-emerald-200 bg-emerald-100 text-emerald-800"
                        : "border-slate-200 bg-slate-200 text-slate-700"
                  }`}
                >
                  {simResult.status}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-slate-200 pt-2.5 text-xs">
                <div>
                  <span className="text-slate-500">Selisih vs SPBU Resmi</span>
                  <p
                    className={`font-mono font-bold ${
                      simResult.delta_vs_official_idr > 0
                        ? "text-rose-600"
                        : simResult.delta_vs_official_idr < 0
                          ? "text-emerald-600"
                          : "text-slate-700"
                    }`}
                  >
                    {simResult.delta_vs_official_idr > 0 ? "+" : simResult.delta_vs_official_idr < 0 ? "-" : ""}
                    Rp {intFmt.format(Math.abs(simResult.delta_vs_official_idr))}/L
                  </p>
                </div>
                <div className="text-right">
                  <span className="block text-slate-500">Latensi Inferensi</span>
                  <p className="mt-0.5 inline-flex items-center justify-end gap-1 font-mono font-semibold text-emerald-700">
                    <Zap className="h-3.5 w-3.5" />
                    {simLoading ? "..." : `${simResult.inference_ms} ms`}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Memuat hasil simulasi...</p>
          )}
        </div>
      </div>

      {/* Kanan: Auto-Insights & Tabel Komparasi 3 Model ML */}
      <div className="flex flex-col gap-6 lg:col-span-7">
        {/* Auto-Insights */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-lg bg-amber-50 p-1.5 text-amber-600">
              <Lightbulb className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Actionable Insights &amp; Rekomendasi Otomatis
              </h2>
              <p className="text-xs text-slate-500">
                Ringkasan eksekutif hasil evaluasi ESDM &amp; atribusi SHAP
              </p>
            </div>
          </div>
          <ul className="space-y-2.5 text-xs leading-relaxed text-slate-700">
            {insights.map((line, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2"
              >
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Model Evaluation Comparison Table */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-indigo-50 p-1.5 text-indigo-600">
                <Award className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Komparasi Evaluasi Model (Time-Series Split 80% / 20%)
                </h2>
                <p className="text-xs text-slate-500">
                  {metadata.train_records} hari latih / {metadata.test_records}{" "}
                  hari uji kronologis terbaru ({metadata.product_name})
                </p>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 font-semibold">Algoritma</th>
                  <th className="px-3 py-2 text-right font-semibold">
                    MAE (Rp/L)
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    RMSE (Rp/L)
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    R² Score
                  </th>
                  <th className="py-2 pl-3 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {modelComparison.map((row) => {
                  const isBest = row.model === bestModelName;
                  return (
                    <tr
                      key={row.model}
                      className={isBest ? "bg-emerald-50/50" : ""}
                    >
                      <td className="py-2.5 pr-3 font-semibold text-slate-800">
                        {row.model}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-900">
                        Rp {row.mae_idr.toFixed(1)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-700">
                        Rp {row.rmse_idr.toFixed(1)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold text-indigo-700">
                        {row.r2_score.toFixed(4)}
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        {isBest ? (
                          <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                            Model Terbaik
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            Pembanding
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
