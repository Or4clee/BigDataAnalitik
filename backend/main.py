"""MacroAgri-BI Pulse backend: Big Data pipeline, ML engine, and FastAPI service."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error

BASE_DIR = Path(__file__).resolve().parent
PARQUET_PATH = BASE_DIR / "data" / "processed" / "macro_agri_1yr.parquet"

# Sentra produksi pangan Pantura Jawa Barat (Subang/Indramayu)
LATITUDE = -6.32
LONGITUDE = 107.76
TIMEZONE = "Asia/Jakarta"
REGION_LABEL = "Sentra Pangan Pantura Jabar (Subang/Indramayu)"

OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    )
}

MARKET_SYMBOLS = {
    "IDR=X": "usd_idr",
    "BZ=F": "brent_oil",
    "ICBP.JK": "food_index",
}

LAG_SPEC: list[tuple[str, str, str]] = [
    ("usd_idr", "usd_idr_lag", "Kurs USD/IDR"),
    ("brent_oil", "brent_oil_lag", "Harga Minyak Brent"),
    ("precip_sum", "precip_sum_lag", "Curah Hujan"),
    ("temp_max", "temp_max_lag", "Suhu Maksimum"),
    ("soil_moisture_mean", "soil_moisture_lag", "Kelembapan Tanah"),
    ("humidity_mean", "humidity_lag", "Kelembapan Udara"),
]
LAG_DAYS = [1, 3, 7, 14]

ROLLING_LABELS = {
    "rain_7d_sum": "Akumulasi Hujan 7 Hari",
    "usd_idr_7d_mean": "Rata-rata Kurs USD/IDR 7 Hari",
}

FEATURE_LABELS: dict[str, str] = {
    f"{prefix}_{lag}": f"{label} (H-{lag})"
    for _, prefix, label in LAG_SPEC
    for lag in LAG_DAYS
}
FEATURE_LABELS.update(ROLLING_LABELS)
FEATURE_COLUMNS: list[str] = list(FEATURE_LABELS.keys())

RAW_DAILY_COLUMNS = [
    "temp_mean",
    "temp_max",
    "precip_sum",
    "humidity_mean",
    "soil_moisture_mean",
    "usd_idr",
    "brent_oil",
    "food_index",
]

_STATE_LOCK = Lock()
_CACHED_MTIME: float | None = None
_CACHED_ANALYTICS: dict[str, Any] | None = None


def _fetch_yahoo_chart_http(symbol: str) -> pd.Series:
    """Fetch daily closing prices using Yahoo Finance v8 Chart API."""
    url = YAHOO_CHART_URL.format(symbol=symbol)
    response = requests.get(
        url,
        params={"range": "2y", "interval": "1d"},
        headers=HTTP_HEADERS,
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()
    results = payload.get("chart", {}).get("result") or []
    if not results:
        raise ValueError(f"Empty Yahoo chart payload for {symbol}")

    result = results[0]
    exchange_tz = result.get("meta", {}).get("exchangeTimezoneName", "UTC")
    timestamps = result.get("timestamp") or []
    quotes = (result.get("indicators", {}).get("quote") or [{}])[0]
    closes = quotes.get("close") or []

    records: dict[date, float] = {}
    for ts, close in zip(timestamps, closes):
        if close is None or pd.isna(close):
            continue
        local_date = pd.Timestamp(ts, unit="s", tz="UTC").tz_convert(exchange_tz).date()
        records[local_date] = float(close)

    if not records:
        raise ValueError(f"No valid closing values for {symbol}")

    series = pd.Series(records, name=symbol, dtype="float64")
    return series.sort_index()


def _fetch_yahoo_yfinance(symbol: str) -> pd.Series:
    """Fallback daily price fetcher using yfinance."""
    hist = yf.Ticker(symbol).history(period="2y", interval="1d", auto_adjust=False)
    if hist.empty or "Close" not in hist.columns:
        raise ValueError(f"yfinance returned no data for {symbol}")

    close = hist["Close"].dropna()
    idx = pd.to_datetime(close.index)
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    series = pd.Series(close.to_numpy(dtype="float64"), index=idx.date, name=symbol)
    series = series.groupby(level=0).last()
    return series.sort_index()


def fetch_market_series(symbol: str) -> pd.Series:
    """Fetch daily market closing series with HTTP primary and yfinance fallback."""
    try:
        return _fetch_yahoo_chart_http(symbol)
    except Exception:
        return _fetch_yahoo_yfinance(symbol)


def _parse_open_meteo_hourly(payload: dict[str, Any]) -> pd.DataFrame:
    """Parse Open-Meteo hourly JSON payload into a timestamp-indexed DataFrame."""
    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    if not times:
        raise ValueError("Open-Meteo response missing hourly time series")

    df = pd.DataFrame(
        {
            "temperature_2m": hourly.get("temperature_2m"),
            "precipitation": hourly.get("precipitation"),
            "relative_humidity_2m": hourly.get("relative_humidity_2m"),
            "soil_moisture_0_to_7cm": hourly.get("soil_moisture_0_to_7cm"),
        },
        index=pd.to_datetime(times),
    )
    return df.astype("float64")


def fetch_hourly_weather(
    raw_start_date: date,
    target_start_date: date,
    end_date: date,
) -> tuple[pd.DataFrame, int]:
    """Fetch hourly weather from Open-Meteo and aggregate to daily metrics."""
    hourly_vars = "temperature_2m,precipitation,relative_humidity_2m,soil_moisture_0_to_7cm"
    archive_resp = requests.get(
        OPEN_METEO_ARCHIVE_URL,
        params={
            "latitude": LATITUDE,
            "longitude": LONGITUDE,
            "start_date": raw_start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "hourly": hourly_vars,
            "timezone": TIMEZONE,
        },
        timeout=30,
    )
    archive_resp.raise_for_status()
    hourly_df = _parse_open_meteo_hourly(archive_resp.json())

    # Supplement trailing days from Forecast API if Archive API lags or has nulls
    expected_hours = pd.date_range(
        start=datetime.combine(raw_start_date, datetime.min.time()),
        end=datetime.combine(end_date, datetime.max.time().replace(minute=0, second=0, microsecond=0)),
        freq="h",
    )
    hourly_df = hourly_df.reindex(expected_hours)
    if hourly_df.iloc[-24 * 7 :].isna().any().any():
        forecast_resp = requests.get(
            OPEN_METEO_FORECAST_URL,
            params={
                "latitude": LATITUDE,
                "longitude": LONGITUDE,
                "hourly": hourly_vars,
                "past_days": 14,
                "forecast_days": 1,
                "timezone": TIMEZONE,
            },
            timeout=20,
        )
        if forecast_resp.ok:
            forecast_df = _parse_open_meteo_hourly(forecast_resp.json())
            hourly_df = hourly_df.combine_first(forecast_df).reindex(expected_hours)

    hourly_df["precipitation"] = hourly_df["precipitation"].fillna(0.0)
    hourly_df = hourly_df.ffill().bfill()

    hourly_dates = hourly_df.index.date
    hourly_records_1yr = int(
        ((hourly_dates >= target_start_date) & (hourly_dates <= end_date)).sum()
    )

    hourly_df["date"] = hourly_dates
    daily_weather = hourly_df.groupby("date", as_index=True).agg(
        temp_mean=("temperature_2m", "mean"),
        temp_max=("temperature_2m", "max"),
        precip_sum=("precipitation", "sum"),
        humidity_mean=("relative_humidity_2m", "mean"),
        soil_moisture_mean=("soil_moisture_0_to_7cm", "mean"),
    )
    return daily_weather, hourly_records_1yr


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Compute time-lag (H-1, H-3, H-7, H-14) and 7-day rolling features without leakage."""
    out = df.copy()
    for src_col, prefix, _ in LAG_SPEC:
        for lag in LAG_DAYS:
            out[f"{prefix}_{lag}"] = out[src_col].shift(lag)

    # Shift by 1 day before rolling so day t0 uses strictly historical [t-7, t-1] data
    out["rain_7d_sum"] = out["precip_sum"].shift(1).rolling(window=7, min_periods=1).sum()
    out["usd_idr_7d_mean"] = out["usd_idr"].shift(1).rolling(window=7, min_periods=1).mean()
    return out


def run_ingestion_pipeline() -> pd.DataFrame:
    """Pull real 365-day hourly weather & daily market data, engineer features, save Parquet."""
    market_series = {col: fetch_market_series(sym) for sym, col in MARKET_SYMBOLS.items()}
    end_date = market_series["food_index"].index.max()
    target_start_date = end_date - timedelta(days=364)
    raw_start_date = target_start_date - timedelta(days=20)

    daily_weather, hourly_records_1yr = fetch_hourly_weather(
        raw_start_date=raw_start_date,
        target_start_date=target_start_date,
        end_date=end_date,
    )

    calendar_dates = pd.date_range(raw_start_date, end_date, freq="D").date
    merged = pd.DataFrame(index=calendar_dates)
    merged.index.name = "date"
    merged = merged.join(daily_weather, how="left")

    for col, series in market_series.items():
        merged[col] = series.reindex(calendar_dates)

    # Harmonize market holidays/weekends via forward-fill (plus backward-fill for edge start)
    merged[RAW_DAILY_COLUMNS] = merged[RAW_DAILY_COLUMNS].ffill().bfill()

    featured = build_features(merged)
    dataset_1yr = featured.loc[
        (featured.index >= target_start_date) & (featured.index <= end_date)
    ].copy()

    if dataset_1yr[FEATURE_COLUMNS + ["food_index"]].isna().any().any():
        raise ValueError("Dataset contains NaN values after feature engineering")

    dataset_1yr = dataset_1yr.reset_index().rename(columns={"index": "date"})
    dataset_1yr["date"] = dataset_1yr["date"].astype(str)
    dataset_1yr["hourly_records_count"] = hourly_records_1yr
    dataset_1yr["synced_at"] = datetime.now(ZoneInfo(TIMEZONE)).isoformat()

    PARQUET_PATH.parent.mkdir(parents=True, exist_ok=True)
    dataset_1yr.to_parquet(PARQUET_PATH, index=False, engine="pyarrow")
    return dataset_1yr


def _project_future_seven_days(
    df: pd.DataFrame,
    model: RandomForestRegressor,
    last_date: date,
) -> list[dict[str, Any]]:
    """Iteratively project H+1 to H+7 by advancing lag windows over recent baselines."""
    history_cols = ["usd_idr", "brent_oil", "precip_sum", "temp_max", "soil_moisture_mean", "humidity_mean"]
    sim_df = df[history_cols].tail(21).reset_index(drop=True).copy()

    # Baseline exogenous expectation uses trailing 7-day rolling mean
    baseline_row = sim_df.tail(7).mean().to_dict()
    projections: list[dict[str, Any]] = []

    for step in range(1, 8):
        forecast_date = (last_date + timedelta(days=step)).isoformat()
        feature_row: dict[str, float] = {}
        for src_col, prefix, _ in LAG_SPEC:
            for lag in LAG_DAYS:
                feature_row[f"{prefix}_{lag}"] = float(sim_df[src_col].iloc[-lag])

        feature_row["rain_7d_sum"] = float(sim_df["precip_sum"].tail(7).sum())
        feature_row["usd_idr_7d_mean"] = float(sim_df["usd_idr"].tail(7).mean())

        x_future = pd.DataFrame([feature_row])[FEATURE_COLUMNS]
        pred_val = round(float(model.predict(x_future)[0]), 2)

        projections.append(
            {
                "date": forecast_date,
                "actual": None,
                "predicted": pred_val,
                "actual_line": None,
                "forecast_line": pred_val,
                "is_forecast": True,
                "horizon": f"H+{step}",
            }
        )

        # Shift forward one day so observed shocks ripple through H-1, H-3, H-7, H-14 lags
        sim_df = pd.concat([sim_df, pd.DataFrame([baseline_row])], ignore_index=True)

    return projections


def compute_analytics(df: pd.DataFrame, cache_source: str) -> dict[str, Any]:
    """Train RandomForestRegressor (85/15 chronological split), compute BI attribution & H+7."""
    x_all = df[FEATURE_COLUMNS]
    y_all = df["food_index"]

    split_idx = int(len(df) * 0.85)
    x_train, x_test = x_all.iloc[:split_idx], x_all.iloc[split_idx:]
    y_train, y_test = y_all.iloc[:split_idx], y_all.iloc[split_idx:]

    model = RandomForestRegressor(n_estimators=200, random_state=42)
    model.fit(x_train, y_train)

    y_test_pred = model.predict(x_test)
    mae = round(float(mean_absolute_error(y_test, y_test_pred)), 2)
    rmse = round(float(np.sqrt(mean_squared_error(y_test, y_test_pred))), 2)

    # Top 8 historical factor attribution (%)
    importances = model.feature_importances_
    raw_attribution = [
        {
            "factor": FEATURE_LABELS[col],
            "feature_key": col,
            "importance_pct": round(float(imp) * 100.0, 2),
        }
        for col, imp in zip(FEATURE_COLUMNS, importances)
    ]
    top_8_attribution = sorted(
        raw_attribution,
        key=lambda item: item["importance_pct"],
        reverse=True,
    )[:8]

    # Last 30 actual days + model predictions
    recent_df = df.tail(30).copy()
    recent_preds = model.predict(recent_df[FEATURE_COLUMNS])

    time_series: list[dict[str, Any]] = []
    n_recent = len(recent_df)
    for idx, ((_, row), pred) in enumerate(zip(recent_df.iterrows(), recent_preds)):
        actual_val = round(float(row["food_index"]), 2)
        pred_val = round(float(pred), 2)
        is_last_actual = idx == n_recent - 1
        time_series.append(
            {
                "date": str(row["date"]),
                "actual": actual_val,
                "predicted": pred_val,
                "actual_line": actual_val,
                # Anchor dashed forecast line to the last actual point t0 for seamless chart join
                "forecast_line": actual_val if is_last_actual else None,
                "is_forecast": False,
                "horizon": "t0" if is_last_actual else None,
            }
        )

    last_actual_date = date.fromisoformat(str(df["date"].iloc[-1]))
    future_series = _project_future_seven_days(df, model, last_actual_date)
    time_series.extend(future_series)

    dominant = top_8_attribution[0]
    hourly_records = (
        int(df["hourly_records_count"].iloc[-1])
        if "hourly_records_count" in df.columns
        else len(df) * 24
    )
    synced_at = (
        str(df["synced_at"].iloc[-1])
        if "synced_at" in df.columns
        else datetime.now(ZoneInfo(TIMEZONE)).isoformat()
    )

    return {
        "metadata": {
            "product_name": "MacroAgri-BI Pulse",
            "region": REGION_LABEL,
            "target_symbol": "ICBP.JK",
            "start_date": str(df["date"].iloc[0]),
            "end_date": str(df["date"].iloc[-1]),
            "forecast_end_date": future_series[-1]["date"],
            "hourly_weather_records": hourly_records,
            "daily_records": int(len(df)),
            "train_records": int(len(x_train)),
            "test_records": int(len(x_test)),
            "dominant_factor": dominant["factor"],
            "dominant_factor_pct": dominant["importance_pct"],
            "mae": mae,
            "rmse": rmse,
            "last_synced_at": synced_at,
            "cache_source": cache_source,
        },
        "bi_lag_attribution": top_8_attribution,
        "time_series": time_series,
    }


def get_or_build_analytics(force_sync: bool = False) -> dict[str, Any]:
    """Load Parquet & return analytics using mtime-guarded in-memory cache (<2s)."""
    global _CACHED_MTIME, _CACHED_ANALYTICS

    with _STATE_LOCK:
        if force_sync or not PARQUET_PATH.exists():
            df = run_ingestion_pipeline()
            analytics = compute_analytics(df, cache_source="fresh_sync")
            _CACHED_MTIME = PARQUET_PATH.stat().st_mtime
            _CACHED_ANALYTICS = analytics
            return analytics

        current_mtime = PARQUET_PATH.stat().st_mtime
        if _CACHED_ANALYTICS is not None and _CACHED_MTIME == current_mtime:
            return _CACHED_ANALYTICS

        df = pd.read_parquet(PARQUET_PATH, engine="pyarrow")
        analytics = compute_analytics(df, cache_source="parquet")
        _CACHED_MTIME = current_mtime
        _CACHED_ANALYTICS = analytics
        return analytics


app = FastAPI(
    title="MacroAgri-BI Pulse API",
    description=(
        "REST API untuk analisis Big Data agro-iklim & makroekonomi "
        "serta peramalan indeks komoditas pangan (Random Forest)."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check() -> dict[str, str]:
    """Simple healthcheck endpoint."""
    return {"status": "ok", "service": "MacroAgri-BI Pulse"}


@app.get("/api/dashboard")
def get_dashboard() -> dict[str, Any]:
    """Unified endpoint returning metadata, top-8 lag attribution, and 30D+H+7 series."""
    try:
        return get_or_build_analytics(force_sync=False)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Gagal memuat dasbor: {exc}") from exc


@app.post("/api/pipeline/sync")
def sync_pipeline() -> dict[str, Any]:
    """Trigger fresh 365-day ingestion from Open-Meteo & Yahoo Finance and update Parquet."""
    try:
        analytics = get_or_build_analytics(force_sync=True)
        meta = analytics["metadata"]
        return {
            "status": "success",
            "message": "Pipeline Big Data 365 hari berhasil disinkronkan dan model diperbarui.",
            "rows_processed": meta["daily_records"],
            "hourly_weather_records": meta["hourly_weather_records"],
            "start_date": meta["start_date"],
            "end_date": meta["end_date"],
            "synced_at": meta["last_synced_at"],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Sinkronisasi pipeline gagal: {exc}") from exc


@app.get("/api/bi/attribution")
def get_bi_attribution() -> list[dict[str, Any]]:
    """Return ranked top 8 historical factor attributions (%)."""
    try:
        analytics = get_or_build_analytics(force_sync=False)
        return [
            {
                "factor": item["factor"],
                "importance_pct": item["importance_pct"],
            }
            for item in analytics["bi_lag_attribution"]
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Gagal mengambil atribusi BI: {exc}") from exc


@app.get("/api/ml/predict")
def get_ml_predict() -> dict[str, Any]:
    """Return 30D actual vs predicted series plus H+7 forecast and MAE/RMSE scores."""
    try:
        analytics = get_or_build_analytics(force_sync=False)
        meta = analytics["metadata"]
        return {
            "mae": meta["mae"],
            "rmse": meta["rmse"],
            "time_series": [
                {
                    "date": point["date"],
                    "actual": point["actual"],
                    "predicted": point["predicted"],
                }
                for point in analytics["time_series"]
            ],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Gagal mengambil prediksi ML: {exc}") from exc
