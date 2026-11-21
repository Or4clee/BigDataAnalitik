"""FuelPulse BI FastAPI backend — Hadoop HDFS Clean Serving & What-If Simulator."""

from __future__ import annotations

import math
from threading import Lock
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from ml.explain import run_what_if_simulation
from ml.train import GOLD_ROOT, run_full_training_and_hdfs_export
from pipeline.transform import PRODUCTS
from storage.hdfs_client import HDFSClient

ProductKey = Literal["pertamax", "pertamax_turbo", "dexlite", "pertamina_dex"]


class SimulateRequest(BaseModel):
    product: ProductKey = Field(default="pertamax")
    usd_idr: float = Field(..., ge=10000, le=30000, description="Asumsi kurs USD/IDR")
    brent_usd: float = Field(..., ge=30, le=200, description="Asumsi harga Brent USD/barel")


hdfs_client = HDFSClient()
_SYNC_LOCK = Lock()


def _sanitize_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert NaN/Inf float values from DataFrame dicts to JSON-safe None."""
    cleaned: list[dict[str, Any]] = []
    for row in records:
        item: dict[str, Any] = {}
        for k, v in row.items():
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                item[k] = None
            else:
                item[k] = v
        cleaned.append(item)
    return cleaned


def _ensure_gold_exists(product: str) -> None:
    """Trigger initial batch training + HDFS export only if Gold outputs are missing."""
    summary_path = f"{GOLD_ROOT}/kpi_insights/dashboard_summary_{product}.json"
    if not hdfs_client.exists(summary_path):
        with _SYNC_LOCK:
            if not hdfs_client.exists(summary_path):
                run_full_training_and_hdfs_export(hdfs_client)


app = FastAPI(
    title="FuelPulse BI API",
    description=(
        "REST API FuelPulse BI yang membaca hasil bersih Machine Learning (XGBoost/RF/Ridge + SHAP) "
        "langsung dari Hadoop HDFS Clean Zone via WebHDFS serta menyediakan simulator skenario What-If."
    ),
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check() -> dict[str, Any]:
    """Return service and Hadoop HDFS WebHDFS connection health."""
    return {
        "status": "ok",
        "service": "FuelPulse BI",
        "hdfs": hdfs_client.check_status(),
    }


@app.post("/api/pipeline/sync")
def sync_pipeline() -> dict[str, Any]:
    """Run Bronze->Silver->Gold ML/SHAP batch pipeline and write clean outputs to Hadoop HDFS."""
    try:
        with _SYNC_LOCK:
            result = run_full_training_and_hdfs_export(hdfs_client)
        result["hdfs_status"] = hdfs_client.check_status()
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Sinkronisasi pipeline gagal: {exc}") from exc


@app.get("/api/dashboard")
def get_dashboard(
    product: ProductKey = Query(default="pertamax", description="Produk BBM non-subsidi"),
) -> dict[str, Any]:
    """Read clean Parquet & JSON directly from Hadoop HDFS Clean Zone without re-training ML."""
    if product not in PRODUCTS:
        raise HTTPException(status_code=400, detail=f"Produk tidak dikenali: {product}")

    try:
        _ensure_gold_exists(product)

        summary_obj, src_summary = hdfs_client.read_json(
            f"{GOLD_ROOT}/kpi_insights/dashboard_summary_{product}.json"
        )
        pred_df, src_pred = hdfs_client.read_parquet(
            f"{GOLD_ROOT}/predictions/{product}_forecast.parquet"
        )
        attr_df, _ = hdfs_client.read_parquet(
            f"{GOLD_ROOT}/bi_attribution/{product}_shap.parquet"
        )
        eval_obj, _ = hdfs_client.read_json(f"{GOLD_ROOT}/metrics/model_evaluation.json")

        hdfs_status = hdfs_client.check_status()
        source_storage = src_summary if "Hadoop HDFS" in src_summary else src_pred

        return {
            "source_storage": source_storage,
            "hdfs_status": hdfs_status,
            "metadata": summary_obj["metadata"],
            "kpi": summary_obj["kpi"],
            "bi_lag_attribution": _sanitize_records(attr_df.to_dict(orient="records")),
            "time_series": _sanitize_records(pred_df.to_dict(orient="records")),
            "model_comparison": summary_obj["model_comparison"],
            "all_products_evaluation": eval_obj.get("products", {}),
            "insights": summary_obj["insights"],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Gagal membaca data dari HDFS: {exc}") from exc


@app.post("/api/simulate")
def simulate_scenario(payload: SimulateRequest) -> dict[str, Any]:
    """Run instant What-If scenario inference (<500 ms) using trained model bundle."""
    try:
        _ensure_gold_exists(payload.product)
        return run_what_if_simulation(
            product_key=payload.product,
            assumed_usd_idr=payload.usd_idr,
            assumed_brent_usd=payload.brent_usd,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Simulasi what-if gagal: {exc}") from exc
