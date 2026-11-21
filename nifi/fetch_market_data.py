#!/usr/bin/env python3
"""Apache NiFi ExecuteStreamCommand ingestion script for FuelPulse BI.

Uses only Python standard library so it runs seamlessly inside WSL Ubuntu
(/usr/bin/python3 for Apache NiFi 1.28.1) as well as Windows Python.
Fetches real 365-day hourly and daily market energy + FX data from Yahoo Finance
(RB=F, HO=F, BZ=F, CL=F, IDR=X, ^OVX) and outputs validated JSON to stdout
or to a target file via --output.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import urllib.parse
import urllib.request
from typing import Any

YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    )
}

TICKER_CONFIG: list[tuple[str, str, str, str]] = [
    ("RB=F", "rbob_gasoline", "1y", "1h"),
    ("HO=F", "ulsd_diesel", "1y", "1h"),
    ("BZ=F", "brent_crude", "1y", "1h"),
    ("CL=F", "wti_crude", "1y", "1h"),
    ("IDR=X", "usd_idr", "1y", "1h"),
    ("^OVX", "oil_volatility", "1y", "1d"),
]

DAILY_BACKFILL_CONFIG: list[tuple[str, str, str, str]] = [
    ("RB=F", "rbob_gasoline", "2y", "1d"),
    ("HO=F", "ulsd_diesel", "2y", "1d"),
    ("BZ=F", "brent_crude", "2y", "1d"),
    ("CL=F", "wti_crude", "2y", "1d"),
    ("IDR=X", "usd_idr", "2y", "1d"),
    ("^OVX", "oil_volatility", "2y", "1d"),
]


def fetch_yahoo_ohlc(symbol: str, alias: str, rng: str, interval: str) -> list[dict[str, Any]]:
    """Fetch OHLC rows from Yahoo Finance v8 Chart API."""
    encoded = urllib.parse.quote(symbol, safe="")
    url = f"{YAHOO_CHART_URL.format(symbol=encoded)}?range={rng}&interval={interval}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=25) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    results = payload.get("chart", {}).get("result") or []
    if not results:
        raise ValueError(f"Empty response for {symbol} ({rng}/{interval})")

    result = results[0]
    meta = result.get("meta") or {}
    exchange_tz = meta.get("exchangeTimezoneName", "UTC")
    timestamps = result.get("timestamp") or []
    quote = (result.get("indicators", {}).get("quote") or [{}])[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    rows: list[dict[str, Any]] = []
    for i, ts in enumerate(timestamps):
        close = closes[i] if i < len(closes) else None
        if close is None:
            continue
        o_val = opens[i] if i < len(opens) and opens[i] is not None else close
        h_val = highs[i] if i < len(highs) and highs[i] is not None else close
        l_val = lows[i] if i < len(lows) and lows[i] is not None else close
        v_val = volumes[i] if i < len(volumes) and volumes[i] is not None else 0
        iso_utc = dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc).isoformat()
        rows.append(
            {
                "symbol": symbol,
                "series": alias,
                "interval": interval,
                "exchange_tz": exchange_tz,
                "timestamp": int(ts),
                "datetime_utc": iso_utc,
                "open": float(o_val),
                "high": float(h_val),
                "low": float(l_val),
                "close": float(close),
                "volume": float(v_val),
            }
        )
    return rows


def collect_all_market_data() -> dict[str, Any]:
    """Pull hourly + daily 365-day market datasets and return structured envelope."""
    hourly_rows: list[dict[str, Any]] = []
    daily_rows: list[dict[str, Any]] = []
    series_counts: dict[str, int] = {}

    for symbol, alias, rng, interval in TICKER_CONFIG:
        rows = fetch_yahoo_ohlc(symbol, alias, rng, interval)
        hourly_rows.extend(rows)
        series_counts[f"{symbol}_{interval}"] = len(rows)

    for symbol, alias, rng, interval in DAILY_BACKFILL_CONFIG:
        rows = fetch_yahoo_ohlc(symbol, alias, rng, interval)
        daily_rows.extend(rows)
        series_counts[f"{symbol}_{interval}"] = len(rows)

    return {
        "pipeline": "FuelPulse BI — Apache NiFi Ingestion",
        "ingested_at_utc": dt.datetime.now(tz=dt.timezone.utc).isoformat(),
        "raw_hourly_records": len(hourly_rows),
        "raw_daily_records": len(daily_rows),
        "series_counts": series_counts,
        "hourly_records": hourly_rows,
        "daily_records": daily_rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="FuelPulse BI NiFi Market Data Fetcher")
    parser.add_argument(
        "--output",
        type=str,
        default="",
        help="Optional output JSON file path (defaults to stdout for NiFi ExecuteStreamCommand).",
    )
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Print only metadata summary without full record arrays.",
    )
    args = parser.parse_args()

    envelope = collect_all_market_data()
    if args.summary_only:
        summary = {
            k: v for k, v in envelope.items() if k not in ("hourly_records", "daily_records")
        }
        print(json.dumps(summary, indent=2))
        return

    serialized = json.dumps(envelope)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            fh.write(serialized)
        print(
            json.dumps(
                {
                    "status": "ok",
                    "output": args.output,
                    "raw_hourly_records": envelope["raw_hourly_records"],
                    "raw_daily_records": envelope["raw_daily_records"],
                }
            )
        )
    else:
        sys.stdout.write(serialized)


if __name__ == "__main__":
    main()
