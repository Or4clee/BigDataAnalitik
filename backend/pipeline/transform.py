"""Bronze & Silver Medallion transformation pipeline for FuelPulse BI.

Handles:
- Ingestion of >30,000 real hourly/daily Yahoo Finance rows (RB=F, HO=F, BZ=F, CL=F, IDR=X, ^OVX)
- Bronze Parquet storage in Hadoop HDFS (/fuelpulse/staging/bronze_raw_hourly)
- Daily OHLC & intraday volatility aggregation + forward-fill calendar harmonization (zero leakage)
- International unit conversion to Rp/liter (USD/gal & USD/bbl -> IDR/liter)
- ESDM formula calibration (PPN 11% + PBBKB 5% DKI Jakarta/Jawa) against pertamina_official.csv
- Time-lag feature engineering (H-1, H-3, H-7, H-14, H-21, H-30) and ESDM 25-day rolling means
- Silver Parquet storage in Hadoop HDFS (/fuelpulse/staging/silver_lag_features)
"""

from __future__ import annotations

import importlib.util
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from pipeline.regional_ingestion import fetch_and_persist_regional_1m
from storage.hdfs_client import HDFSClient

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent
OFFICIAL_CSV_PATH = BASE_DIR / "data" / "pertamina_official.csv"
NIFI_FETCH_SCRIPT = REPO_ROOT / "nifi" / "fetch_market_data.py"

BRONZE_HDFS_PATH = "/fuelpulse/staging/bronze_raw_hourly/market_hourly_1yr.parquet"
SILVER_HDFS_PATH = "/fuelpulse/staging/silver_lag_features/silver_features_1yr.parquet"

TIMEZONE = "Asia/Jakarta"
REGION_LABEL = "DKI Jakarta & Pulau Jawa (PBBKB 5%)"
LITERS_PER_GALLON = 3.785411784
LITERS_PER_BARREL = 158.987294928
TAX_MULTIPLIER_DKI = 1.16  # PPN 11% + PBBKB 5%

LAG_WINDOWS = [1, 3, 7, 14, 21, 30]

PRODUCTS: dict[str, dict[str, Any]] = {
    "pertamax": {
        "key": "pertamax",
        "name": "Pertamax (RON 92)",
        "short_name": "Pertamax",
        "spec": "RON 92",
        "category": "gasoline",
        "benchmark_col": "rbob_idr_per_liter",
        "benchmark_vol_col": "rbob_volatility",
        "benchmark_label": "RBOB Gasoline",
        "benchmark_ticker": "RB=F",
        "round_step": 50,
    },
    "pertamax_turbo": {
        "key": "pertamax_turbo",
        "name": "Pertamax Turbo (RON 98)",
        "short_name": "Pertamax Turbo",
        "spec": "RON 98",
        "category": "gasoline",
        "benchmark_col": "rbob_idr_per_liter",
        "benchmark_vol_col": "rbob_volatility",
        "benchmark_label": "RBOB Gasoline",
        "benchmark_ticker": "RB=F",
        "round_step": 50,
    },
    "dexlite": {
        "key": "dexlite",
        "name": "Dexlite (CN 51)",
        "short_name": "Dexlite",
        "spec": "CN 51",
        "category": "diesel",
        "benchmark_col": "ulsd_idr_per_liter",
        "benchmark_vol_col": "ulsd_volatility",
        "benchmark_label": "NY Harbor ULSD",
        "benchmark_ticker": "HO=F",
        "round_step": 50,
    },
    "pertamina_dex": {
        "key": "pertamina_dex",
        "name": "Pertamina Dex (CN 53)",
        "short_name": "Pertamina Dex",
        "spec": "CN 53",
        "category": "diesel",
        "benchmark_col": "ulsd_idr_per_liter",
        "benchmark_vol_col": "ulsd_volatility",
        "benchmark_label": "NY Harbor ULSD",
        "benchmark_ticker": "HO=F",
        "round_step": 50,
    },
}


def _load_nifi_fetcher() -> Any:
    """Dynamically load nifi/fetch_market_data.py so ingestion logic stays single-sourced."""
    spec = importlib.util.spec_from_file_location("fuelpulse_nifi_fetcher", NIFI_FETCH_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Tidak dapat memuat skrip NiFi: {NIFI_FETCH_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def get_product_feature_spec(product_key: str) -> list[tuple[str, str, str]]:
    """Return list of (column_name, Indonesian label, lag_window) for a product."""
    cfg = PRODUCTS[product_key]
    bench_prefix = "rbob" if cfg["category"] == "gasoline" else "ulsd"
    bench_label = cfg["benchmark_label"]

    specs: list[tuple[str, str, str]] = [
        (
            f"{bench_prefix}_idr_25d_mean",
            f"Rata-rata {bench_label} (25 Hari ESDM)",
            "H-1 s/d H-25",
        ),
        ("usd_idr_25d_mean", "Rata-rata Kurs USD/IDR (25 Hari ESDM)", "H-1 s/d H-25"),
        ("brent_usd_25d_mean", "Rata-rata Minyak Brent (25 Hari ESDM)", "H-1 s/d H-25"),
    ]
    for lag in LAG_WINDOWS:
        specs.append((f"{bench_prefix}_idr_lag_{lag}", f"{bench_label} Rp/L (H-{lag})", f"H-{lag}"))
        specs.append((f"usd_idr_lag_{lag}", f"Kurs USD/IDR (H-{lag})", f"H-{lag}"))
        specs.append((f"brent_usd_lag_{lag}", f"Minyak Mentah Brent (H-{lag})", f"H-{lag}"))

    specs.extend(
        [
            ("wti_usd_lag_1", "Minyak Mentah WTI (H-1)", "H-1"),
            ("wti_usd_lag_7", "Minyak Mentah WTI (H-7)", "H-7"),
            ("wti_usd_lag_14", "Minyak Mentah WTI (H-14)", "H-14"),
            ("ovx_lag_1", "Volatilitas Minyak ^OVX (H-1)", "H-1"),
            ("ovx_lag_7", "Volatilitas Minyak ^OVX (H-7)", "H-7"),
            (f"{bench_prefix}_vol_lag_1", f"Volatilitas Intraday {bench_label} (H-1)", "H-1"),
            (f"{bench_prefix}_vol_lag_7", f"Volatilitas Intraday {bench_label} (H-7)", "H-7"),
            ("nat_rain_lag_1", "Curah Hujan Nasional 125 Hub (H-1)", "H-1"),
            ("nat_rain_lag_7", "Curah Hujan Nasional 125 Hub (H-7)", "H-7"),
            ("nat_wind_lag_1", "Angin Puncak Logistik 125 Hub (H-1)", "H-1"),
            ("logistics_idx_lag_1", "Indeks Cuaca Ekstrem Distribusi (H-1)", "H-1"),
        ]
    )
    return specs


def _aggregate_series_daily(
    hourly_df: pd.DataFrame,
    daily_df: pd.DataFrame,
    series_name: str,
) -> pd.DataFrame:
    """Aggregate hourly OHLC to daily metrics, backfilled with 2y daily OHLC for warm-up."""
    d_sub = daily_df[daily_df["series"] == series_name].copy()
    d_sub["local_date"] = pd.to_datetime(d_sub["datetime_utc"], utc=True).dt.tz_convert(TIMEZONE).dt.date
    d_daily = d_sub.sort_values("timestamp").groupby("local_date", as_index=True).agg(
        open=("open", "first"),
        high=("high", "max"),
        low=("low", "min"),
        close=("close", "last"),
    )
    d_daily["daily_volatility"] = (
        (d_daily["high"] - d_daily["low"]) / d_daily["close"].replace(0, np.nan)
    ).fillna(0.0)

    h_sub = hourly_df[hourly_df["series"] == series_name].copy()
    if not h_sub.empty:
        h_sub["local_date"] = (
            pd.to_datetime(h_sub["datetime_utc"], utc=True).dt.tz_convert(TIMEZONE).dt.date
        )
        h_daily = h_sub.sort_values("timestamp").groupby("local_date", as_index=True).agg(
            open=("open", "first"),
            high=("high", "max"),
            low=("low", "min"),
            close=("close", "last"),
        )
        h_daily["daily_volatility"] = (
            (h_daily["high"] - h_daily["low"]) / h_daily["close"].replace(0, np.nan)
        ).fillna(0.0)
        # Prefer hourly-aggregated daily bars where present, backfill earlier dates with daily OHLC
        combined = h_daily.combine_first(d_daily).sort_index()
    else:
        combined = d_daily.sort_index()

    return combined


def _calibrate_economic_parity(
    merged: pd.DataFrame,
    official_df: pd.DataFrame,
) -> tuple[pd.DataFrame, dict[str, dict[str, float]]]:
    """Calibrate ESDM Daily Economic Parity Price (PPN 11% + PBBKB 5%) for all 4 products."""
    out = merged.copy()
    calibrations: dict[str, dict[str, float]] = {}

    for product_key, cfg in PRODUCTS.items():
        bench_col = cfg["benchmark_col"]
        # ESDM base energy cost proxy (75% refined product MOPS proxy + 25% Brent crude Rp/L)
        energy_cost_daily = 0.75 * out[bench_col] + 0.25 * out["brent_idr_per_liter"]
        # ESDM 25-day evaluation window rolling average (prior 25 days)
        esdm_window_cost = energy_cost_daily.shift(1).rolling(window=25, min_periods=5).mean()

        # Fit (slope, alpha) on the 13 official Pertamina release dates in DKI Jakarta (tax 1.16)
        sample_x: list[float] = []
        sample_y_pretax: list[float] = []
        for _, row in official_df.iterrows():
            eff_date = pd.to_datetime(row["effective_date"]).date()
            if eff_date in esdm_window_cost.index and pd.notna(esdm_window_cost.loc[eff_date]):
                sample_x.append(float(esdm_window_cost.loc[eff_date]))
                sample_y_pretax.append(float(row[product_key]) / TAX_MULTIPLIER_DKI)

        x_arr = np.asarray(sample_x, dtype=float)
        y_arr = np.asarray(sample_y_pretax, dtype=float)
        if len(x_arr) >= 3 and np.std(x_arr) > 1e-6:
            slope, alpha = np.polyfit(x_arr, y_arr, 1)
            # Keep physically realistic positive pass-through slope and non-negative distribution alpha
            slope = float(np.clip(slope, 0.85, 1.45))
            alpha = float(np.mean(y_arr - slope * x_arr))
            if alpha < 800.0:
                alpha = 800.0
                slope = float(np.mean((y_arr - alpha) / np.maximum(x_arr, 1.0)))
        else:
            slope, alpha = 1.05, 1800.0

        # Smooth 7-day economic parity reflects ESDM pricing mechanics while responding daily to shocks
        smoothed_cost = energy_cost_daily.rolling(window=7, min_periods=1).mean()
        parity_series = (slope * smoothed_cost + alpha) * TAX_MULTIPLIER_DKI
        out[f"parity_{product_key}"] = parity_series.round(2)

        calibrations[product_key] = {
            "slope": round(slope, 6),
            "alpha_idr": round(alpha, 2),
            "tax_multiplier": TAX_MULTIPLIER_DKI,
        }

    return out, calibrations


def _add_lag_and_rolling_features(df: pd.DataFrame) -> pd.DataFrame:
    """Create H-1..H-30 lag features and ESDM 25-day rolling averages without data leakage."""
    out = df.copy()

    # ESDM 25-day evaluation window rolling means (strictly shifted by 1 day -> H-1..H-25)
    out["rbob_idr_25d_mean"] = out["rbob_idr_per_liter"].shift(1).rolling(25, min_periods=1).mean()
    out["ulsd_idr_25d_mean"] = out["ulsd_idr_per_liter"].shift(1).rolling(25, min_periods=1).mean()
    out["usd_idr_25d_mean"] = out["usd_idr"].shift(1).rolling(25, min_periods=1).mean()
    out["brent_usd_25d_mean"] = out["brent_usd"].shift(1).rolling(25, min_periods=1).mean()

    for lag in LAG_WINDOWS:
        out[f"rbob_idr_lag_{lag}"] = out["rbob_idr_per_liter"].shift(lag)
        out[f"ulsd_idr_lag_{lag}"] = out["ulsd_idr_per_liter"].shift(lag)
        out[f"usd_idr_lag_{lag}"] = out["usd_idr"].shift(lag)
        out[f"brent_usd_lag_{lag}"] = out["brent_usd"].shift(lag)

    for lag in (1, 7, 14):
        out[f"wti_usd_lag_{lag}"] = out["wti_usd"].shift(lag)

    for lag in (1, 7):
        out[f"ovx_lag_{lag}"] = out["ovx_close"].shift(lag)
        out[f"rbob_vol_lag_{lag}"] = out["rbob_volatility"].shift(lag)
        out[f"ulsd_vol_lag_{lag}"] = out["ulsd_volatility"].shift(lag)

    # Strictly lagged national logistics & weather indicators from 125 Indonesian fuel hubs
    out["nat_rain_lag_1"] = out["nat_rain_mean_mm"].shift(1)
    out["nat_rain_lag_7"] = out["nat_rain_mean_mm"].shift(7)
    out["nat_wind_lag_1"] = out["nat_wind_max_kmh"].shift(1)
    out["logistics_idx_lag_1"] = out["logistics_disruption_idx"].shift(1)

    return out


def run_bronze_silver_pipeline(
    hdfs: HDFSClient,
    force_refresh_regional: bool = False,
) -> dict[str, Any]:
    """Execute Bronze ingestion (market + 1.095M regional weather rows) & Silver feature engineering."""
    fetcher = _load_nifi_fetcher()
    envelope = fetcher.collect_all_market_data()

    hourly_df = pd.DataFrame(envelope["hourly_records"])
    daily_df = pd.DataFrame(envelope["daily_records"])
    market_hourly_rows = int(envelope["raw_hourly_records"])

    # 1. Persist Bronze market hourly Parquet to HDFS Staging
    bronze_uploaded = hdfs.put_parquet(BRONZE_HDFS_PATH, hourly_df)

    # 2. Aggregate hourly + daily backfill per series
    series_frames = {
        alias: _aggregate_series_daily(hourly_df, daily_df, alias)
        for alias in (
            "rbob_gasoline",
            "ulsd_diesel",
            "brent_crude",
            "wti_crude",
            "usd_idr",
            "oil_volatility",
        )
    }

    end_date = max(
        series_frames["rbob_gasoline"].index.max(),
        series_frames["brent_crude"].index.max(),
        series_frames["usd_idr"].index.max(),
    )
    # Keep anchor within real observed dates across primary benchmarks
    end_date = min(end_date, datetime.now(ZoneInfo(TIMEZONE)).date())
    target_start_date = end_date - timedelta(days=364)  # Exact 365 calendar days
    raw_start_date = target_start_date - timedelta(days=45)  # Warm-up for H-30 & 25-day rolling

    # 3. Ingest 1,095,000+ real hourly spatial-temporal weather rows across 125 hubs (38 provinces)
    regional_info = fetch_and_persist_regional_1m(
        hdfs=hdfs,
        start_date=target_start_date,
        end_date=end_date,
        force_refresh=force_refresh_regional,
    )
    daily_logistics_df: pd.DataFrame = regional_info["daily_logistics_df"].copy()
    daily_logistics_df["local_date"] = pd.to_datetime(daily_logistics_df["date"]).dt.date
    daily_logistics_indexed = daily_logistics_df.set_index("local_date").sort_index()

    cal_index = pd.date_range(raw_start_date, end_date, freq="D").date
    merged = pd.DataFrame(index=cal_index)
    merged.index.name = "date"

    merged["rbob_close"] = series_frames["rbob_gasoline"]["close"].reindex(cal_index)
    merged["rbob_open"] = series_frames["rbob_gasoline"]["open"].reindex(cal_index)
    merged["rbob_high"] = series_frames["rbob_gasoline"]["high"].reindex(cal_index)
    merged["rbob_low"] = series_frames["rbob_gasoline"]["low"].reindex(cal_index)
    merged["rbob_volatility"] = series_frames["rbob_gasoline"]["daily_volatility"].reindex(cal_index)

    merged["ulsd_close"] = series_frames["ulsd_diesel"]["close"].reindex(cal_index)
    merged["ulsd_volatility"] = series_frames["ulsd_diesel"]["daily_volatility"].reindex(cal_index)

    merged["brent_usd"] = series_frames["brent_crude"]["close"].reindex(cal_index)
    merged["wti_usd"] = series_frames["wti_crude"]["close"].reindex(cal_index)
    merged["usd_idr"] = series_frames["usd_idr"]["close"].reindex(cal_index)
    merged["ovx_close"] = series_frames["oil_volatility"]["close"].reindex(cal_index)

    # Join national daily logistics & weather features (aggregated from 1,095,000+ real hourly rows)
    for col in ("nat_rain_mean_mm", "nat_wind_max_kmh", "nat_temp_mean_c", "logistics_disruption_idx"):
        merged[col] = daily_logistics_indexed[col].reindex(cal_index)

    # Harmonize holidays/weekends via Forward Fill (plus bfill only for initial edge)
    merged = merged.ffill().bfill()

    # Convert international fuel & crude benchmarks to Rp/liter
    merged["rbob_idr_per_liter"] = (merged["rbob_close"] / LITERS_PER_GALLON) * merged["usd_idr"]
    merged["ulsd_idr_per_liter"] = (merged["ulsd_close"] / LITERS_PER_GALLON) * merged["usd_idr"]
    merged["brent_idr_per_liter"] = (merged["brent_usd"] / LITERS_PER_BARREL) * merged["usd_idr"]
    merged["wti_idr_per_liter"] = (merged["wti_usd"] / LITERS_PER_BARREL) * merged["usd_idr"]

    # Map official monthly Pertamina prices (DKI Jakarta / Java PBBKB 5%) onto daily calendar
    official_df = pd.read_csv(OFFICIAL_CSV_PATH)
    official_indexed = official_df.copy()
    official_indexed["effective_date"] = pd.to_datetime(official_indexed["effective_date"]).dt.date
    official_indexed = official_indexed.set_index("effective_date").sort_index()

    for prod_key in PRODUCTS:
        step_series = official_indexed[prod_key].reindex(cal_index, method="ffill")
        step_series = step_series.bfill()
        merged[f"official_{prod_key}"] = step_series.astype(float)

    # Calibrate Daily Economic Parity Price (PPN 11% + PBBKB 5%)
    merged, calibrations = _calibrate_economic_parity(merged, official_df)

    # Engineer lag (H-1..H-30) and ESDM 25-day rolling features
    featured = _add_lag_and_rolling_features(merged)

    # Slice exact 365-day analytical window
    silver_1yr = featured.loc[
        (featured.index >= target_start_date) & (featured.index <= end_date)
    ].copy()
    silver_1yr = silver_1yr.reset_index().rename(columns={"index": "date"})
    silver_1yr["date"] = silver_1yr["date"].astype(str)

    if silver_1yr.isna().any().any():
        silver_1yr = silver_1yr.ffill().bfill()

    silver_uploaded = hdfs.put_parquet(SILVER_HDFS_PATH, silver_1yr)
    regional_hourly_rows = int(regional_info["regional_hourly_rows"])
    total_bronze_hourly_rows = market_hourly_rows + regional_hourly_rows

    return {
        "silver_df": silver_1yr,
        "provincial_weather_df": regional_info["provincial_weather_df"],
        "calibrations": calibrations,
        "raw_hourly_records": total_bronze_hourly_rows,
        "market_hourly_rows": market_hourly_rows,
        "regional_hourly_rows": regional_hourly_rows,
        "hubs_count": int(regional_info["hubs_count"]),
        "provinces_count": int(regional_info["provinces_count"]),
        "series_counts": envelope["series_counts"],
        "start_date": str(silver_1yr["date"].iloc[0]),
        "end_date": str(silver_1yr["date"].iloc[-1]),
        "bronze_uploaded": bronze_uploaded,
        "regional_bronze_uploaded": bool(regional_info["bronze_uploaded"]),
        "silver_uploaded": silver_uploaded,
        "ingested_at": datetime.now(ZoneInfo(TIMEZONE)).isoformat(),
    }
