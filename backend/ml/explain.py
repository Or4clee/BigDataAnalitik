"""SHAP Lag Attribution, Auto-Insights Generator, and What-If Simulator (<500 ms)."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import shap

from pipeline.transform import (
    LITERS_PER_BARREL,
    LITERS_PER_GALLON,
    PRODUCTS,
    TAX_MULTIPLIER_DKI,
)

BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_DIR = BASE_DIR / "data" / "models"

_BUNDLE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def round_retail_price(price_idr: float, step: int = 50) -> int:
    """Round retail fuel price to nearest Rp 50/liter (Pertamina convention)."""
    return int(round(price_idr / step) * step)


def classify_price_status(delta_idr: int) -> str:
    """Classify price adjustment direction: NAIK, TURUN, or STABIL."""
    if delta_idr >= 50:
        return "NAIK"
    if delta_idr <= -50:
        return "TURUN"
    return "STABIL"


def compute_shap_attribution(
    tree_model: Any,
    x_background: pd.DataFrame,
    x_latest: pd.DataFrame,
    feature_spec: list[tuple[str, str, str]],
    top_n: int = 8,
) -> list[dict[str, Any]]:
    """Extract SHAP TreeExplainer monetary impacts (Rp/L) and global importance (%)."""
    feature_cols = [item[0] for item in feature_spec]
    explainer = shap.TreeExplainer(tree_model)
    shap_all = np.asarray(explainer.shap_values(x_background[feature_cols]), dtype=float)
    shap_latest = np.asarray(explainer.shap_values(x_latest[feature_cols]), dtype=float).reshape(-1)

    mean_abs_shap = np.mean(np.abs(shap_all), axis=0)
    shap_norm = mean_abs_shap / max(float(np.sum(mean_abs_shap)), 1e-9)

    if hasattr(tree_model, "feature_importances_"):
        g_imp = np.asarray(tree_model.feature_importances_, dtype=float)
        g_norm = g_imp / max(float(np.sum(g_imp)), 1e-9)
        blended = 0.65 * shap_norm + 0.35 * g_norm
    else:
        blended = shap_norm

    blended = blended / max(float(np.sum(blended)), 1e-9)

    items: list[dict[str, Any]] = []
    for idx, (col, label, lag_window) in enumerate(feature_spec):
        items.append(
            {
                "factor": label,
                "feature_key": col,
                "lag_window": lag_window,
                "importance_pct": round(float(blended[idx]) * 100.0, 2),
                "shap_impact_idr": int(round(float(shap_latest[idx]))),
            }
        )

    items.sort(key=lambda r: r["importance_pct"], reverse=True)
    return items[:top_n]


def generate_actionable_insights(
    product_name: str,
    current_official: int,
    today_parity: int,
    next_month_pred: int,
    next_adjustment_date: str,
    delta_idr: int,
    status: str,
    top_attributions: list[dict[str, Any]],
    best_model_name: str,
    mae_idr: float,
    r2_score: float,
) -> list[str]:
    """Generate 3–4 Indonesian actionable insight sentences per FR-06."""
    parity_gap = today_parity - current_official
    gap_dir = "di atas" if parity_gap >= 0 else "di bawah"
    insights: list[str] = [
        (
            f"Harga keekonomian {product_name} hari ini berada di Rp {today_parity:,}/L "
            f"(Rp {abs(parity_gap):,}/L {gap_dir} harga resmi SPBU saat ini Rp {current_official:,}/L)."
        ).replace(",", ".")
    ]

    if len(top_attributions) >= 2:
        f1 = top_attributions[0]
        f2 = top_attributions[1]
        s1 = f"+Rp {f1['shap_impact_idr']:,}/L" if f1["shap_impact_idr"] >= 0 else f"-Rp {abs(f1['shap_impact_idr']):,}/L"
        s2 = f"+Rp {f2['shap_impact_idr']:,}/L" if f2["shap_impact_idr"] >= 0 else f"-Rp {abs(f2['shap_impact_idr']):,}/L"
        insights.append(
            (
                f"Faktor historis paling dominan adalah {f1['factor']} sebesar {f1['importance_pct']:.1f}% "
                f"({s1}) diikuti {f2['factor']} sebesar {f2['importance_pct']:.1f}% ({s2})."
            ).replace(",", ".")
        )

    if status == "NAIK" and delta_idr >= 200:
        insights.append(
            (
                f"Rekomendasi Operasional: Prediksi penyesuaian tanggal {next_adjustment_date} menunjukkan "
                f"potensi kenaikan Rp {delta_idr:,}/L menuju Rp {next_month_pred:,}/L, sehingga disarankan "
                f"melakukan pengisian penuh tangki armada sebelum tanggal 1."
            ).replace(",", ".")
        )
    elif status == "TURUN" and abs(delta_idr) >= 200:
        insights.append(
            (
                f"Rekomendasi Operasional: Prediksi penyesuaian tanggal {next_adjustment_date} mengindikasikan "
                f"potensi penurunan Rp {abs(delta_idr):,}/L menuju Rp {next_month_pred:,}/L, pertimbangkan "
                f"pengisian secukupnya hingga penyesuaian resmi berlaku."
            ).replace(",", ".")
        )
    else:
        insights.append(
            (
                f"Rekomendasi Operasional: Estimasi harga tanggal {next_adjustment_date} berada di kisaran "
                f"Rp {next_month_pred:,}/L (status {status}, selisih {delta_idr:+,} Rp/L), sehingga anggaran "
                f"bahan bakar bulanan cenderung terkendali."
            ).replace(",", ".")
        )

    insights.append(
        f"Evaluasi model terbaik ({best_model_name}) mencatat MAE Rp {mae_idr:.1f}/L dengan R² {r2_score:.3f} pada 20% data uji kronologis terbaru."
    )
    return insights


def load_model_bundle(product_key: str) -> dict[str, Any]:
    """Load persisted model bundle with mtime-based in-memory caching for <500 ms simulation."""
    bundle_path = MODEL_DIR / f"{product_key}_bundle.joblib"
    if not bundle_path.exists():
        raise FileNotFoundError(
            f"Artefak model untuk produk '{product_key}' belum tersedia. Jalankan /api/pipeline/sync terlebih dahulu."
        )
    mtime = bundle_path.stat().st_mtime
    cached = _BUNDLE_CACHE.get(product_key)
    if cached is not None and cached[0] == mtime:
        return cached[1]
    bundle = joblib.load(bundle_path)
    _BUNDLE_CACHE[product_key] = (mtime, bundle)
    return bundle


def run_what_if_simulation(
    product_key: str,
    assumed_usd_idr: float,
    assumed_brent_usd: float,
) -> dict[str, Any]:
    """Run instant What-If inference (<500 ms) for custom USD/IDR & Brent assumptions."""
    t0 = time.perf_counter()
    if product_key not in PRODUCTS:
        raise ValueError(f"Produk tidak valid: {product_key}")

    bundle = load_model_bundle(product_key)
    cfg = PRODUCTS[product_key]
    bench_prefix = "rbob" if cfg["category"] == "gasoline" else "ulsd"

    base_usd = float(bundle["latest_usd_idr"])
    base_brent = float(bundle["latest_brent_usd"])
    base_bench_usd_gal = float(bundle["latest_benchmark_usd_gal"])

    fx_ratio = assumed_usd_idr / max(base_usd, 1.0)
    brent_ratio = assumed_brent_usd / max(base_brent, 1.0)

    # Shift latest feature vector according to simulated FX and crude scenario
    sim_features = dict(bundle["latest_feature_row"])
    for key, val in list(sim_features.items()):
        if key.startswith("usd_idr"):
            sim_features[key] = float(val) * fx_ratio
        elif key.startswith("brent_usd") or key.startswith("wti_usd"):
            sim_features[key] = float(val) * brent_ratio
        elif key.startswith(f"{bench_prefix}_idr"):
            sim_features[key] = float(val) * fx_ratio * brent_ratio

    feature_cols: list[str] = bundle["feature_columns"]
    x_sim = pd.DataFrame([sim_features])[feature_cols]
    model_pred = float(bundle["best_model"].predict(x_sim)[0])

    # ESDM structural parity anchor guarantees monotonic economic response even beyond training extrema
    cal = bundle["calibration"]
    sim_bench_idr_l = ((base_bench_usd_gal * brent_ratio) / LITERS_PER_GALLON) * assumed_usd_idr
    sim_brent_idr_l = (assumed_brent_usd / LITERS_PER_BARREL) * assumed_usd_idr
    esdm_energy_cost = 0.75 * sim_bench_idr_l + 0.25 * sim_brent_idr_l
    structural_parity = (cal["slope"] * esdm_energy_cost + cal["alpha_idr"]) * TAX_MULTIPLIER_DKI

    # Blend trained ML inference with structural ESDM calibration (prevents flat tree clipping at slider edges)
    if bundle["best_model_name"] == "RidgeRegression":
        simulated_parity = model_pred
    else:
        simulated_parity = 0.65 * model_pred + 0.35 * structural_parity

    simulated_parity_int = int(round(simulated_parity))
    simulated_retail = round_retail_price(simulated_parity, step=cfg["round_step"])
    current_official = int(bundle["current_official_price"])
    baseline_parity = int(bundle["today_economic_parity"])
    delta_vs_official = simulated_retail - current_official
    delta_vs_baseline = simulated_parity_int - baseline_parity
    status = classify_price_status(delta_vs_official)

    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
    return {
        "product": product_key,
        "product_name": cfg["name"],
        "assumed_usd_idr": round(float(assumed_usd_idr), 2),
        "assumed_brent_usd": round(float(assumed_brent_usd), 2),
        "baseline_usd_idr": round(base_usd, 2),
        "baseline_brent_usd": round(base_brent, 2),
        "current_official_price": current_official,
        "baseline_parity_price": baseline_parity,
        "simulated_parity_price": simulated_parity_int,
        "simulated_retail_price": simulated_retail,
        "delta_vs_official_idr": int(delta_vs_official),
        "delta_vs_baseline_idr": int(delta_vs_baseline),
        "status": status,
        "model_used": bundle["best_model_name"],
        "inference_ms": elapsed_ms,
    }
