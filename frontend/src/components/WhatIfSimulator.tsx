"use client";

import React, { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
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
    <section
      aria-label="Simulator Skenario dan Evaluasi Model"
      className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12"
    >
      <div className="rounded-lg border border-stone-300 bg-white p-5 lg:col-span-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-petrol-700">
              Simulator Skenario What-If
            </p>
            <h2 className="mt-0.5 text-lg font-bold text-stone-900">
              Sensitivitas Kurs dan Minyak Brent
            </h2>
            <p className="mt-1 text-xs text-stone-600">
              Geser asumsi makro untuk menyimulasikan estimasi harga{" "}
              <strong className="text-stone-900">{metadata.product_name}</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-md border border-stone-500 bg-white px-3 py-2 text-xs font-semibold text-stone-800 transition hover:bg-stone-100 active:bg-stone-200"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <label
                htmlFor="slider-usd-idr"
                className="font-semibold text-stone-800"
              >
                Asumsi Kurs USD/IDR
              </label>
              <span className="rounded border border-stone-400 bg-stone-100 px-2 py-0.5 font-mono font-bold tabular-nums text-stone-900">
                Rp {intFmt.format(usdIdr)}
              </span>
            </div>
            <div className="flex min-h-[44px] items-center">
              <input
                id="slider-usd-idr"
                type="range"
                min={USD_MIN}
                max={USD_MAX}
                step={50}
                value={usdIdr}
                onChange={(e) => setUsdIdr(Number(e.target.value))}
              />
            </div>
            <div className="flex justify-between font-mono text-xs text-stone-600">
              <span>Rp 14.500</span>
              <span>
                Terkini: Rp {intFmt.format(Math.round(metadata.latest_usd_idr))}
              </span>
              <span>Rp 19.500</span>
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <label
                htmlFor="slider-brent"
                className="font-semibold text-stone-800"
              >
                Asumsi Minyak Mentah Brent
              </label>
              <span className="rounded border border-stone-400 bg-stone-100 px-2 py-0.5 font-mono font-bold tabular-nums text-stone-900">
                ${brentUsd.toFixed(1)} / barel
              </span>
            </div>
            <div className="flex min-h-[44px] items-center">
              <input
                id="slider-brent"
                type="range"
                min={BRENT_MIN}
                max={BRENT_MAX}
                step={0.5}
                value={brentUsd}
                onChange={(e) => setBrentUsd(Number(e.target.value))}
              />
            </div>
            <div className="flex justify-between font-mono text-xs text-stone-600">
              <span>$55/bbl</span>
              <span>Terkini: ${metadata.latest_brent_usd.toFixed(1)}/bbl</span>
              <span>$120/bbl</span>
            </div>
          </div>
        </div>

        <div
          aria-live="polite"
          className="mt-5 rounded-md border border-stone-300 bg-stone-50 p-4"
        >
          {simError ? (
            <p role="alert" className="text-xs font-medium text-rose-800">
              {simError}
            </p>
          ) : simResult ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-stone-600">
                    Estimasi Harga Ritel Simulasi (Terbulatkan)
                  </p>
                  <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums text-stone-900">
                    Rp {intFmt.format(simResult.simulated_retail_price)}
                    <span className="ml-1 text-xs font-normal text-stone-600">
                      /L
                    </span>
                  </p>
                </div>
                <span
                  className={`rounded border px-2.5 py-1 text-xs font-bold ${
                    simResult.status === "NAIK"
                      ? "border-rose-700 bg-rose-50 text-rose-900"
                      : simResult.status === "TURUN"
                        ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                        : "border-stone-500 bg-stone-200 text-stone-800"
                  }`}
                >
                  {simResult.status === "NAIK"
                    ? "▲ NAIK"
                    : simResult.status === "TURUN"
                      ? "▼ TURUN"
                      : "= STABIL"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-stone-300 pt-3 text-xs">
                <div>
                  <span className="block text-stone-600">
                    Selisih vs SPBU Resmi
                  </span>
                  <p
                    className={`mt-0.5 font-mono font-bold tabular-nums ${
                      simResult.delta_vs_official_idr > 0
                        ? "text-rose-700"
                        : simResult.delta_vs_official_idr < 0
                          ? "text-emerald-700"
                          : "text-stone-800"
                    }`}
                  >
                    {simResult.delta_vs_official_idr > 0
                      ? "+"
                      : simResult.delta_vs_official_idr < 0
                        ? "-"
                        : ""}
                    Rp{" "}
                    {intFmt.format(Math.abs(simResult.delta_vs_official_idr))}/L
                  </p>
                </div>
                <div className="text-right">
                  <span className="block text-stone-600">
                    Latensi Inferensi
                  </span>
                  <p className="mt-0.5 font-mono font-semibold tabular-nums text-petrol-800">
                    {simLoading ? "Menghitung..." : `${simResult.inference_ms} ms`}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-stone-600">
              Menyiapkan hasil simulasi skenario...
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:col-span-7">
        <div className="rounded-lg border border-stone-300 bg-white p-5">
          <div className="mb-3">
            <h2 className="text-base font-bold text-stone-900">
              Ringkasan Temuan dan Rekomendasi Operasional
            </h2>
            <p className="mt-0.5 text-xs text-stone-600">
              Disusun otomatis dari hasil evaluasi formula ESDM dan atribusi SHAP.
            </p>
          </div>
          <ul className="space-y-2.5 text-xs leading-relaxed text-stone-800">
            {insights.map((line, idx) => (
              <li
                key={idx}
                className="rounded border border-stone-200 bg-stone-50 px-3.5 py-2.5"
              >
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-stone-300 bg-white p-5">
          <div className="mb-3">
            <h2 className="text-base font-bold text-stone-900">
              Komparasi Evaluasi Model (Time-Series Split 80% / 20%)
            </h2>
            <p className="mt-0.5 text-xs text-stone-600">
              {metadata.train_records} hari latih dan {metadata.test_records}{" "}
              hari uji kronologis terbaru ({metadata.product_name}).
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stone-300 text-stone-700">
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
                  <th className="py-2 pl-3 text-right font-semibold">
                    Keterangan
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {modelComparison.map((row) => {
                  const isBest = row.model === bestModelName;
                  return (
                    <tr
                      key={row.model}
                      className={isBest ? "bg-petrol-50/70" : ""}
                    >
                      <td className="py-2.5 pr-3 font-semibold text-stone-900">
                        {row.model}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-stone-900">
                        Rp {row.mae_idr.toFixed(1)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-stone-700">
                        Rp {row.rmse_idr.toFixed(1)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-petrol-800">
                        {row.r2_score.toFixed(4)}
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        {isBest ? (
                          <span className="inline-flex rounded border border-petrol-700 bg-petrol-50 px-2 py-0.5 text-[11px] font-bold text-petrol-800">
                            Model Terbaik
                          </span>
                        ) : (
                          <span className="text-xs text-stone-600">
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
