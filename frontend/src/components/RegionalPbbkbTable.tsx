"use client";

import React, { useMemo, useState } from "react";
import type { BronzeBreakdown, RegionalPriceRow } from "@/lib/api";

interface RegionalPbbkbTableProps {
  rows: RegionalPriceRow[];
  productName: string;
  nextAdjustmentDate: string;
  bronzeBreakdown?: BronzeBreakdown;
}

type PbbkbFilter = "all" | "5" | "7.5" | "10";

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

function getStatusBadge(status: "NAIK" | "TURUN" | "STABIL") {
  if (status === "NAIK") {
    return {
      cls: "border-rose-700 bg-rose-50 text-rose-900",
      marker: "▲",
      text: "text-rose-700",
    };
  }
  if (status === "TURUN") {
    return {
      cls: "border-emerald-700 bg-emerald-50 text-emerald-900",
      marker: "▼",
      text: "text-emerald-700",
    };
  }
  return {
    cls: "border-stone-500 bg-stone-100 text-stone-800",
    marker: "=",
    text: "text-stone-700",
  };
}

export function RegionalPbbkbTable({
  rows,
  productName,
  nextAdjustmentDate,
  bronzeBreakdown,
}: RegionalPbbkbTableProps) {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [pbbkbFilter, setPbbkbFilter] = useState<PbbkbFilter>("all");
  const [showAll, setShowAll] = useState<boolean>(false);

  const tierCounts = useMemo(() => {
    const counts = { all: rows.length, "5": 0, "7.5": 0, "10": 0 };
    for (const r of rows) {
      if (Math.abs(r.pbbkb_pct - 5) < 0.05) counts["5"] += 1;
      else if (Math.abs(r.pbbkb_pct - 7.5) < 0.05) counts["7.5"] += 1;
      else if (Math.abs(r.pbbkb_pct - 10) < 0.05) counts["10"] += 1;
    }
    return counts;
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (pbbkbFilter !== "all") {
        const target = Number(pbbkbFilter);
        if (Math.abs(row.pbbkb_pct - target) >= 0.05) return false;
      }
      if (!q) return true;
      return (
        row.province.toLowerCase().includes(q) ||
        row.region_group.toLowerCase().includes(q)
      );
    });
  }, [rows, searchQuery, pbbkbFilter]);

  const isFiltered = searchQuery.trim().length > 0 || pbbkbFilter !== "all";
  const visibleRows =
    showAll || isFiltered ? filteredRows : filteredRows.slice(0, 10);

  if (rows.length === 0) {
    return null;
  }

  const filterButtons: Array<{ key: PbbkbFilter; label: string }> = [
    { key: "all", label: `Semua (${tierCounts.all})` },
    { key: "5", label: `PBBKB 5% (${tierCounts["5"]})` },
    { key: "7.5", label: `PBBKB 7,5% (${tierCounts["7.5"]})` },
    { key: "10", label: `PBBKB 10% (${tierCounts["10"]})` },
  ];

  return (
    <section
      aria-label="Matriks Harga Regional 38 Provinsi dan Cuaca Logistik"
      className="mt-6 rounded-lg border border-stone-300 bg-white p-5 sm:p-6"
    >
      <div className="flex flex-col gap-3 border-b border-stone-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-base font-bold text-stone-900">
            Proyeksi Harga Regional 38 Provinsi ({productName})
          </h2>
          <p className="mt-0.5 text-xs text-stone-600">
            Penyesuaian resmi tarif PBBKB daerah (5%, 7,5%, dan 10%) serta
            agregasi cuaca logistik per-jam dari{" "}
            <strong className="font-mono text-stone-900">
              {bronzeBreakdown
                ? intFmt.format(bronzeBreakdown.regional_weather_hourly_rows)
                : "1.095.000"}
            </strong>{" "}
            baris riil pada{" "}
            <strong className="font-mono text-stone-900">
              {bronzeBreakdown ? bronzeBreakdown.hubs_count : 125} hub
            </strong>{" "}
            distribusi BBM di Hadoop HDFS.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-700">
          <span className="rounded border border-stone-300 bg-stone-50 px-2.5 py-1">
            Target Penyesuaian:{" "}
            <strong className="font-mono text-stone-900">
              {nextAdjustmentDate}
            </strong>
          </span>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="w-full lg:max-w-xs">
          <label
            htmlFor="regional-search"
            className="block text-xs font-semibold text-stone-700"
          >
            Cari provinsi atau wilayah
          </label>
          <input
            id="regional-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Contoh: Jawa Barat, Kalimantan, Papua..."
            className="mt-1 block min-h-[44px] w-full rounded-md border border-stone-500 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-500 focus:border-petrol-700 focus:outline-none"
          />
        </div>

        <div
          role="group"
          aria-label="Filter Tarif PBBKB Provinsi"
          className="flex flex-wrap gap-2"
        >
          {filterButtons.map((btn) => {
            const active = pbbkbFilter === btn.key;
            return (
              <button
                key={btn.key}
                type="button"
                aria-pressed={active}
                onClick={() => setPbbkbFilter(btn.key)}
                className={`min-h-[44px] rounded-md px-3 py-2 text-xs transition ${
                  active
                    ? "border-2 border-petrol-700 bg-petrol-50 font-bold text-petrol-900"
                    : "border border-stone-500 bg-white font-semibold text-stone-800 hover:bg-stone-50"
                }`}
              >
                {btn.label}
              </button>
            );
          })}
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <div className="mt-5 rounded-md border border-stone-300 bg-stone-50 p-5 text-center">
          <p className="text-sm font-semibold text-stone-900">
            Tidak ada provinsi yang cocok dengan filter saat ini.
          </p>
          <p className="mt-1 text-xs text-stone-600">
            Ubah kata kunci pencarian atau pilih tarif PBBKB lainnya.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setPbbkbFilter("all");
            }}
            className="mt-3 min-h-[44px] rounded-md border border-stone-500 bg-white px-4 py-2 text-xs font-semibold text-stone-900 hover:bg-stone-100"
          >
            Reset Filter
          </button>
        </div>
      ) : (
        <>
          {/* Desktop & Tablet Ledger Table */}
          <div className="mt-4 hidden overflow-x-auto rounded-md border border-stone-300 md:block">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="border-b border-stone-300 bg-stone-100 text-stone-700">
                <tr>
                  <th scope="col" className="px-3.5 py-2.5 font-semibold">
                    Provinsi & Wilayah
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    PBBKB
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Harga SPBU
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Prediksi Tgl 1
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Selisih & Status
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Observasi Riil
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Cuaca Ekstrem
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200 bg-white">
                {visibleRows.map((row) => {
                  const badge = getStatusBadge(row.status);
                  return (
                    <tr
                      key={row.province}
                      className="transition hover:bg-stone-50"
                    >
                      <td className="px-3.5 py-2.5">
                        <p className="font-semibold text-stone-900">
                          {row.province}
                        </p>
                        <p className="text-[11px] text-stone-600">
                          {row.region_group} ({row.hubs_count} hub)
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-stone-800">
                        {decFmt.format(row.pbbkb_pct)}%
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-stone-800">
                        {formatRupiah(row.official_price_prov)}/L
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums text-stone-900">
                        {formatRupiah(row.predicted_next_month_prov)}/L
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <span
                            className={`font-mono font-semibold tabular-nums ${badge.text}`}
                          >
                            {formatSignedRupiah(row.delta_idr_prov)}
                          </span>
                          <span
                            className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[11px] font-bold ${badge.cls}`}
                          >
                            <span aria-hidden="true">{badge.marker}</span>
                            {row.status}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-stone-700">
                        {intFmt.format(row.hourly_observations)} jam
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-stone-700">
                        {row.severe_weather_pct.toFixed(2)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Ledger Cards (Zero horizontal overflow at 375px) */}
          <div className="mt-4 divide-y divide-stone-200 rounded-md border border-stone-300 md:hidden">
            {visibleRows.map((row) => {
              const badge = getStatusBadge(row.status);
              return (
                <div key={row.province} className="bg-white p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-stone-900">
                        {row.province}
                      </p>
                      <p className="text-xs text-stone-600">
                        {row.region_group} | PBBKB {decFmt.format(row.pbbkb_pct)}%
                        ({row.hubs_count} hub)
                      </p>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}
                    >
                      <span aria-hidden="true">{badge.marker}</span>
                      {row.status}
                    </span>
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-stone-100 pt-2 text-xs">
                    <div>
                      <span className="text-stone-600">SPBU Resmi:</span>
                      <p className="font-mono font-semibold tabular-nums text-stone-900">
                        {formatRupiah(row.official_price_prov)}/L
                      </p>
                    </div>
                    <div>
                      <span className="text-stone-600">Prediksi Tgl 1:</span>
                      <p className="font-mono font-bold tabular-nums text-stone-900">
                        {formatRupiah(row.predicted_next_month_prov)}/L{" "}
                        <span className={badge.text}>
                          ({formatSignedRupiah(row.delta_idr_prov)})
                        </span>
                      </p>
                    </div>
                    <div>
                      <span className="text-stone-600">Observasi Cuaca:</span>
                      <p className="font-mono tabular-nums text-stone-800">
                        {intFmt.format(row.hourly_observations)} jam
                      </p>
                    </div>
                    <div>
                      <span className="text-stone-600">Cuaca Ekstrem:</span>
                      <p className="font-mono tabular-nums text-stone-800">
                        {row.severe_weather_pct.toFixed(2)}%
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <p className="text-xs text-stone-600">
              Menampilkan{" "}
              <strong className="font-mono text-stone-900">
                {visibleRows.length}
              </strong>{" "}
              dari{" "}
              <strong className="font-mono text-stone-900">
                {filteredRows.length}
              </strong>{" "}
              provinsi.
            </p>
            {!isFiltered && filteredRows.length > 10 && (
              <button
                type="button"
                onClick={() => setShowAll((prev) => !prev)}
                className="min-h-[44px] rounded-md border border-stone-500 bg-white px-4 py-2 text-xs font-semibold text-stone-900 transition hover:bg-stone-50"
              >
                {showAll
                  ? "Ringkas (10 Provinsi)"
                  : `Tampilkan Semua (${filteredRows.length} Provinsi)`}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
