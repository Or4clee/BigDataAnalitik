"""Real 1,000,000+ row spatial-temporal weather & logistics ingestion across 125 Indonesian fuel hubs.

Fetches 365 days of hourly real weather observations (temperature_2m, precipitation, wind_speed_10m)
from Open-Meteo Historical Archive API across 125 fuel distribution hubs spanning all 38 Indonesian
provinces (125 hubs x 365 days x 24 hours = 1,095,000 real hourly rows) and stores the compressed
Apache Parquet file in Hadoop HDFS (/fuelpulse/staging/bronze_raw_hourly/regional_logistics_weather_1m.parquet).
"""

from __future__ import annotations

import time
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import requests

from storage.hdfs_client import HDFSClient

BASE_DIR = Path(__file__).resolve().parent.parent
HUBS_CSV_PATH = BASE_DIR / "data" / "indonesia_fuel_hubs.csv"

OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
REGIONAL_BRONZE_HDFS_PATH = (
    "/fuelpulse/staging/bronze_raw_hourly/regional_logistics_weather_1m.parquet"
)
REGIONAL_DAILY_HDFS_PATH = (
    "/fuelpulse/staging/silver_lag_features/regional_daily_logistics_1yr.parquet"
)
PROVINCIAL_WEATHER_SUMMARY_HDFS_PATH = (
    "/fuelpulse/staging/silver_lag_features/provincial_weather_summary.parquet"
)

BATCH_SIZE = 25


def load_fuel_hubs() -> pd.DataFrame:
    """Load the 125 Indonesian fuel distribution hubs covering all 38 provinces."""
    return pd.read_csv(HUBS_CSV_PATH)


def _fetch_open_meteo_batch(
    hubs_batch: pd.DataFrame,
    start_date: date,
    end_date: date,
) -> list[dict[str, Any]]:
    """Fetch a 25-hub multi-location batch from Open-Meteo Archive API with retry."""
    lats = ",".join(f"{val:.4f}" for val in hubs_batch["latitude"].tolist())
    lons = ",".join(f"{val:.4f}" for val in hubs_batch["longitude"].tolist())
    params = {
        "latitude": lats,
        "longitude": lons,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "hourly": "temperature_2m,precipitation,wind_speed_10m",
        "timezone": "Asia/Jakarta",
    }

    last_err: Exception | None = None
    for attempt in range(3):
        try:
            resp = requests.get(OPEN_METEO_ARCHIVE_URL, params=params, timeout=60)
            resp.raise_for_status()
            payload = resp.json()
            if isinstance(payload, dict):
                return [payload]
            if isinstance(payload, list):
                return payload
            raise ValueError("Unexpected Open-Meteo response structure")
        except Exception as exc:
            last_err = exc
            time.sleep(2.0 * (attempt + 1))

    raise RuntimeError(f"Open-Meteo batch fetch gagal setelah 3 percobaan: {last_err}")


def fetch_and_persist_regional_1m(
    hdfs: HDFSClient,
    start_date: date,
    end_date: date,
    force_refresh: bool = False,
) -> dict[str, Any]:
    """Ingest or load 1,095,000+ real hourly weather rows across 125 hubs and compute daily & provincial summaries."""
    hubs_df = load_fuel_hubs()

    if (
        not force_refresh
        and hdfs.exists(REGIONAL_BRONZE_HDFS_PATH)
        and hdfs.exists(REGIONAL_DAILY_HDFS_PATH)
        and hdfs.exists(PROVINCIAL_WEATHER_SUMMARY_HDFS_PATH)
    ):
        daily_df, _ = hdfs.read_parquet(REGIONAL_DAILY_HDFS_PATH)
        prov_df, _ = hdfs.read_parquet(PROVINCIAL_WEATHER_SUMMARY_HDFS_PATH)
        if not daily_df.empty and str(daily_df["date"].iloc[-1]) >= end_date.isoformat():
            total_rows = int(prov_df["hourly_observations"].sum())
            if total_rows >= 1_000_000:
                return {
                    "regional_hourly_rows": total_rows,
                    "hubs_count": int(len(hubs_df)),
                    "provinces_count": int(hubs_df["province"].nunique()),
                    "daily_logistics_df": daily_df,
                    "provincial_weather_df": prov_df,
                    "bronze_uploaded": True,
                    "reused_hdfs_cache": True,
                }

    frames: list[pd.DataFrame] = []
    n_hubs = len(hubs_df)
    for start_idx in range(0, n_hubs, BATCH_SIZE):
        batch = hubs_df.iloc[start_idx : start_idx + BATCH_SIZE].reset_index(drop=True)
        responses = _fetch_open_meteo_batch(batch, start_date, end_date)

        for idx, item in enumerate(responses):
            hub = batch.iloc[idx]
            hourly = item.get("hourly") or {}
            times = hourly.get("time") or []
            if not times:
                continue
            temps = np.asarray(hourly.get("temperature_2m"), dtype="float32")
            precips = np.asarray(hourly.get("precipitation"), dtype="float32")
            winds = np.asarray(hourly.get("wind_speed_10m"), dtype="float32")

            n = len(times)
            df_hub = pd.DataFrame(
                {
                    "timestamp_wib": times,
                    "date": [t[:10] for t in times],
                    "hub_id": np.full(n, str(hub["hub_id"]), dtype=object),
                    "city": np.full(n, str(hub["city"]), dtype=object),
                    "province": np.full(n, str(hub["province"]), dtype=object),
                    "region_group": np.full(n, str(hub["region_group"]), dtype=object),
                    "pbbkb_rate": np.full(n, float(hub["pbbkb_rate"]), dtype="float32"),
                    "temperature_2m": temps,
                    "precipitation": np.nan_to_num(precips, nan=0.0),
                    "wind_speed_10m": np.nan_to_num(winds, nan=0.0),
                }
            )
            frames.append(df_hub)

        if start_idx + BATCH_SIZE < n_hubs:
            time.sleep(0.6)

    regional_bronze_df = pd.concat(frames, ignore_index=True)
    # Forward/backward fill rare missing hourly temperature readings cleanly
    regional_bronze_df["temperature_2m"] = (
        regional_bronze_df["temperature_2m"].ffill().bfill()
    )
    regional_hourly_rows = int(len(regional_bronze_df))

    # Persist full 1,095,000+ row Bronze Parquet to Hadoop HDFS
    bronze_uploaded = hdfs.put_parquet(REGIONAL_BRONZE_HDFS_PATH, regional_bronze_df)

    # Compute daily national logistics & weather index across all 125 hubs
    regional_bronze_df["severe_hour"] = (
        (regional_bronze_df["precipitation"] >= 5.0)
        | (regional_bronze_df["wind_speed_10m"] >= 30.0)
    ).astype("float32")

    daily_hub = (
        regional_bronze_df.groupby(["date", "hub_id"], as_index=False)
        .agg(
            hub_rain_mm=("precipitation", "sum"),
            hub_wind_max=("wind_speed_10m", "max"),
            hub_temp_mean=("temperature_2m", "mean"),
            hub_severe_ratio=("severe_hour", "mean"),
        )
    )

    daily_logistics_df = (
        daily_hub.groupby("date", as_index=False)
        .agg(
            nat_rain_mean_mm=("hub_rain_mm", "mean"),
            nat_wind_max_kmh=("hub_wind_max", "max"),
            nat_temp_mean_c=("hub_temp_mean", "mean"),
            logistics_disruption_idx=("hub_severe_ratio", "mean"),
        )
        .sort_values("date")
        .reset_index(drop=True)
    )
    # Scale logistics disruption index to percentage (0-100)
    daily_logistics_df["logistics_disruption_idx"] = (
        daily_logistics_df["logistics_disruption_idx"] * 100.0
    ).round(3)

    # Compute provincial 365-day weather & logistics summary across all 38 provinces
    provincial_weather_df = (
        regional_bronze_df.groupby(["province", "region_group"], as_index=False)
        .agg(
            pbbkb_rate=("pbbkb_rate", "first"),
            hubs_count=("hub_id", "nunique"),
            hourly_observations=("timestamp_wib", "count"),
            avg_temp_c=("temperature_2m", "mean"),
            total_rain_mm=("precipitation", "sum"),
            max_wind_kmh=("wind_speed_10m", "max"),
            severe_weather_pct=("severe_hour", "mean"),
        )
        .sort_values(["pbbkb_rate", "province"])
        .reset_index(drop=True)
    )
    # Normalize total annual rain per hub for fair cross-province comparison
    provincial_weather_df["annual_rain_per_hub_mm"] = (
        provincial_weather_df["total_rain_mm"] / provincial_weather_df["hubs_count"]
    ).round(1)
    provincial_weather_df["avg_temp_c"] = provincial_weather_df["avg_temp_c"].round(1)
    provincial_weather_df["max_wind_kmh"] = provincial_weather_df["max_wind_kmh"].round(1)
    provincial_weather_df["severe_weather_pct"] = (
        provincial_weather_df["severe_weather_pct"] * 100.0
    ).round(2)

    hdfs.put_parquet(REGIONAL_DAILY_HDFS_PATH, daily_logistics_df)
    hdfs.put_parquet(PROVINCIAL_WEATHER_SUMMARY_HDFS_PATH, provincial_weather_df)

    return {
        "regional_hourly_rows": regional_hourly_rows,
        "hubs_count": int(hubs_df["hub_id"].nunique()),
        "provinces_count": int(hubs_df["province"].nunique()),
        "daily_logistics_df": daily_logistics_df,
        "provincial_weather_df": provincial_weather_df,
        "bronze_uploaded": bronze_uploaded,
        "reused_hdfs_cache": False,
    }
