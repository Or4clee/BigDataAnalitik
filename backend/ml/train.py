"""Batch ML training, model comparison (XGBoost vs RF vs Ridge), SHAP, and HDFS Gold export."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor

from ml.explain import (
    MODEL_DIR,
    classify_price_status,
    compute_shap_attribution,
    generate_actionable_insights,
    round_retail_price,
)
from pipeline.transform import (
    LAG_WINDOWS,
    PRODUCTS,
    REGION_LABEL,
    TIMEZONE,
    get_product_feature_spec,
    run_bronze_silver_pipeline,
)
from storage.hdfs_client import HDFSClient

GOLD_ROOT = "/fuelpulse/gold_clean_analytics"


def _next_first_of_month(current_day: date) -> date:
    """Return the 1st day of the next calendar month after current_day."""
    if current_day.month == 12:
        return date(current_day.year + 1, 1, 1)
    return date(current_day.year, current_day.month + 1, 1)


def _project_to_next_month(
    silver_df: pd.DataFrame,
    model: Any,
    product_key: str,
    feature_cols: list[str],
    last_date: date,
    target_date: date,
) -> list[dict[str, Any]]:
    """Iteratively project daily economic parity from t0+1 up to 1st of next month."""
    cfg = PRODUCTS[product_key]
    bench_prefix = "rbob" if cfg["category"] == "gasoline" else "ulsd"
    bench_col = cfg["benchmark_col"]
    bench_vol_col = cfg["benchmark_vol_col"]

    sim_cols = [bench_col, "usd_idr", "brent_usd", "wti_usd", "ovx_close", bench_vol_col]
    sim_df = silver_df[sim_cols].tail(35).reset_index(drop=True).copy()

    # Carry forward trailing 7-day average for exogenous variables while real lags ripple forward
    baseline_row = sim_df.tail(7).mean().to_dict()
    horizon_days = max(1, (target_date - last_date).days)
    current_official = float(silver_df[f"official_{product_key}"].iloc[-1])

    projections: list[dict[str, Any]] = []
    for step in range(1, horizon_days + 1):
        f_date = last_date + timedelta(days=step)
        feat: dict[str, float] = {
            f"{bench_prefix}_idr_25d_mean": float(sim_df[bench_col].tail(25).mean()),
            "usd_idr_25d_mean": float(sim_df["usd_idr"].tail(25).mean()),
            "brent_usd_25d_mean": float(sim_df["brent_usd"].tail(25).mean()),
        }
        for lag in LAG_WINDOWS:
            feat[f"{bench_prefix}_idr_lag_{lag}"] = float(sim_df[bench_col].iloc[-lag])
            feat[f"usd_idr_lag_{lag}"] = float(sim_df["usd_idr"].iloc[-lag])
            feat[f"brent_usd_lag_{lag}"] = float(sim_df["brent_usd"].iloc[-lag])

        for lag in (1, 7, 14):
            feat[f"wti_usd_lag_{lag}"] = float(sim_df["wti_usd"].iloc[-lag])
        for lag in (1, 7):
            feat[f"ovx_lag_{lag}"] = float(sim_df["ovx_close"].iloc[-lag])
            feat[f"{bench_prefix}_vol_lag_{lag}"] = float(sim_df[bench_vol_col].iloc[-lag])

        x_future = pd.DataFrame([feat])[feature_cols]
        pred_val = round(float(model.predict(x_future)[0]), 2)

        projections.append(
            {
                "date": f_date.isoformat(),
                "official_price": current_official if f_date < target_date else None,
                "economic_parity": None,
                "predicted_price": pred_val,
                "forecast_line": pred_val,
                "is_forecast": True,
                "horizon": f"H+{step}",
            }
        )
        sim_df = pd.concat([sim_df, pd.DataFrame([baseline_row])], ignore_index=True)

    return projections


def run_full_training_and_hdfs_export(hdfs: HDFSClient) -> dict[str, Any]:
    """Run Bronze->Silver->ML/SHAP batch pipeline and write all Gold outputs to Hadoop HDFS."""
    stage_result = run_bronze_silver_pipeline(hdfs)
    silver_df: pd.DataFrame = stage_result["silver_df"]
    calibrations: dict[str, dict[str, float]] = stage_result["calibrations"]

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    last_date = date.fromisoformat(stage_result["end_date"])
    next_adj_date = _next_first_of_month(last_date)

    split_idx = int(len(silver_df) * 0.80)  # Chronological 80% Train / 20% Test
    all_evaluations: dict[str, Any] = {}
    hdfs_write_results: dict[str, bool] = {
        "bronze_parquet": stage_result["bronze_uploaded"],
        "silver_parquet": stage_result["silver_uploaded"],
    }

    for product_key, cfg in PRODUCTS.items():
        feature_spec = get_product_feature_spec(product_key)
        feature_cols = [item[0] for item in feature_spec]
        target_col = f"parity_{product_key}"

        x_all = silver_df[feature_cols]
        y_all = silver_df[target_col]

        x_train, x_test = x_all.iloc[:split_idx], x_all.iloc[split_idx:]
        y_train, y_test = y_all.iloc[:split_idx], y_all.iloc[split_idx:]

        candidates = {
            "XGBoostRegressor": XGBRegressor(
                n_estimators=220,
                max_depth=4,
                learning_rate=0.05,
                subsample=0.85,
                colsample_bytree=0.85,
                reg_alpha=1.0,
                reg_lambda=5.0,
                random_state=42,
                n_jobs=4,
            ),
            "RandomForestRegressor": RandomForestRegressor(
                n_estimators=200,
                max_depth=10,
                random_state=42,
                n_jobs=4,
            ),
            "RidgeRegression": make_pipeline(StandardScaler(), Ridge(alpha=5.0)),
        }

        comparison_rows: list[dict[str, Any]] = []
        fitted_models: dict[str, Any] = {}

        for model_name, estimator in candidates.items():
            estimator.fit(x_train, y_train)
            y_pred_test = estimator.predict(x_test)
            mae_val = round(float(mean_absolute_error(y_test, y_pred_test)), 2)
            rmse_val = round(float(np.sqrt(mean_squared_error(y_test, y_pred_test))), 2)
            r2_val = round(float(r2_score(y_test, y_pred_test)), 4)

            fitted_models[model_name] = estimator
            comparison_rows.append(
                {
                    "model": model_name,
                    "mae_idr": mae_val,
                    "rmse_idr": rmse_val,
                    "r2_score": r2_val,
                }
            )

        # Select best model by lowest MAE on chronological 20% test split
        comparison_rows.sort(key=lambda r: r["mae_idr"])
        best_metrics = comparison_rows[0]
        best_model_name = best_metrics["model"]
        best_model = fitted_models[best_model_name]

        # Refit best model & XGBoost TreeExplainer on full 365-day dataset for latest production inference
        # (evaluation metrics remain strictly from the 80/20 chronological split — zero leakage!)
        if best_model_name == "XGBoostRegressor":
            prod_model = XGBRegressor(
                n_estimators=220,
                max_depth=4,
                learning_rate=0.05,
                subsample=0.85,
                colsample_bytree=0.85,
                reg_alpha=1.0,
                reg_lambda=5.0,
                random_state=42,
                n_jobs=4,
            )
        elif best_model_name == "RandomForestRegressor":
            prod_model = RandomForestRegressor(
                n_estimators=200,
                max_depth=10,
                random_state=42,
                n_jobs=4,
            )
        else:
            prod_model = make_pipeline(StandardScaler(), Ridge(alpha=5.0))
        prod_model.fit(x_all, y_all)

        # Always fit XGBoost on full dataset for SHAP TreeExplainer attribution (PRD Section 4.2)
        shap_tree_model = (
            prod_model
            if best_model_name in ("XGBoostRegressor", "RandomForestRegressor")
            else fitted_models["XGBoostRegressor"].fit(x_all, y_all)
        )
        bi_attribution = compute_shap_attribution(
            tree_model=shap_tree_model,
            x_background=x_all,
            x_latest=x_all.iloc[[-1]],
            feature_spec=feature_spec,
            top_n=8,
        )

        # Historical series (last 60 days so 2 monthly official steps + smooth parity are visible)
        recent_df = silver_df.tail(60).copy()
        # Use out-of-sample test model for historical predictions where available to avoid overfitting look
        hist_preds = best_model.predict(recent_df[feature_cols])

        time_series: list[dict[str, Any]] = []
        n_recent = len(recent_df)
        for idx, ((_, row), pred_val) in enumerate(zip(recent_df.iterrows(), hist_preds)):
            is_last = idx == n_recent - 1
            parity_val = round(float(row[target_col]), 2)
            official_val = round(float(row[f"official_{product_key}"]), 2)
            time_series.append(
                {
                    "date": str(row["date"]),
                    "official_price": official_val,
                    "economic_parity": parity_val,
                    "predicted_price": round(float(pred_val), 2),
                    "forecast_line": parity_val if is_last else None,
                    "is_forecast": False,
                    "horizon": "t0" if is_last else None,
                }
            )

        future_points = _project_to_next_month(
            silver_df=silver_df,
            model=prod_model,
            product_key=product_key,
            feature_cols=feature_cols,
            last_date=last_date,
            target_date=next_adj_date,
        )
        time_series.extend(future_points)

        current_official = int(round(float(silver_df[f"official_{product_key}"].iloc[-1])))
        today_parity = int(round(float(silver_df[target_col].iloc[-1])))
        # Next month prediction reflects ESDM evaluation average across projected horizon ending 1st of next month
        projected_window_mean = float(np.mean([p["predicted_price"] for p in future_points]))
        next_month_prediction = round_retail_price(projected_window_mean, step=cfg["round_step"])
        delta_idr = next_month_prediction - current_official
        status = classify_price_status(delta_idr)

        insights = generate_actionable_insights(
            product_name=cfg["name"],
            current_official=current_official,
            today_parity=today_parity,
            next_month_pred=next_month_prediction,
            next_adjustment_date=next_adj_date.isoformat(),
            delta_idr=delta_idr,
            status=status,
            top_attributions=bi_attribution,
            best_model_name=best_model_name,
            mae_idr=best_metrics["mae_idr"],
            r2_score=best_metrics["r2_score"],
        )

        # Save joblib bundle for instant (<500ms) What-If simulation
        bench_usd_col = "rbob_close" if cfg["category"] == "gasoline" else "ulsd_close"
        bundle = {
            "product": product_key,
            "best_model_name": best_model_name,
            "best_model": prod_model,
            "feature_columns": feature_cols,
            "latest_feature_row": {col: float(x_all[col].iloc[-1]) for col in feature_cols},
            "latest_usd_idr": float(silver_df["usd_idr"].iloc[-1]),
            "latest_brent_usd": float(silver_df["brent_usd"].iloc[-1]),
            "latest_benchmark_usd_gal": float(silver_df[bench_usd_col].iloc[-1]),
            "current_official_price": current_official,
            "today_economic_parity": today_parity,
            "calibration": calibrations[product_key],
        }
        joblib.dump(bundle, MODEL_DIR / f"{product_key}_bundle.joblib")

        # Write clean ML outputs directly to Hadoop HDFS Gold Clean Zone
        pred_df = pd.DataFrame(time_series)
        attr_df = pd.DataFrame(bi_attribution)

        hdfs_write_results[f"predictions_{product_key}"] = hdfs.put_parquet(
            f"{GOLD_ROOT}/predictions/{product_key}_forecast.parquet",
            pred_df,
        )
        hdfs_write_results[f"attribution_{product_key}"] = hdfs.put_parquet(
            f"{GOLD_ROOT}/bi_attribution/{product_key}_shap.parquet",
            attr_df,
        )

        summary_payload = {
            "metadata": {
                "product_key": product_key,
                "product_name": cfg["name"],
                "spec": cfg["spec"],
                "category": cfg["category"],
                "benchmark_label": cfg["benchmark_label"],
                "benchmark_ticker": cfg["benchmark_ticker"],
                "region": REGION_LABEL,
                "start_date": stage_result["start_date"],
                "end_date": stage_result["end_date"],
                "date_range": f"{stage_result['start_date']} s/d {stage_result['end_date']}",
                "raw_hourly_records": stage_result["raw_hourly_records"],
                "daily_records": int(len(silver_df)),
                "train_records": int(len(x_train)),
                "test_records": int(len(x_test)),
                "series_counts": stage_result["series_counts"],
                "last_synced_at": stage_result["ingested_at"],
                "latest_usd_idr": round(float(silver_df["usd_idr"].iloc[-1]), 2),
                "latest_brent_usd": round(float(silver_df["brent_usd"].iloc[-1]), 2),
            },
            "kpi": {
                "current_official_price": current_official,
                "today_economic_parity": today_parity,
                "parity_gap_idr": today_parity - current_official,
                "next_month_prediction": next_month_prediction,
                "next_adjustment_date": next_adj_date.isoformat(),
                "delta_idr": delta_idr,
                "status": status,
                "model_metrics": {
                    "best_model": best_model_name,
                    "mae_idr": best_metrics["mae_idr"],
                    "rmse_idr": best_metrics["rmse_idr"],
                    "r2_score": best_metrics["r2_score"],
                },
            },
            "model_comparison": comparison_rows,
            "insights": insights,
        }
        hdfs_write_results[f"summary_{product_key}"] = hdfs.put_json(
            f"{GOLD_ROOT}/kpi_insights/dashboard_summary_{product_key}.json",
            summary_payload,
        )

        all_evaluations[product_key] = {
            "product_name": cfg["name"],
            "best_model": best_model_name,
            "metrics": comparison_rows,
            "calibration": calibrations[product_key],
        }

    evaluation_payload = {
        "evaluated_at": datetime.now(ZoneInfo(TIMEZONE)).isoformat(),
        "split_strategy": "Time-Series Split (80% Train / 20% Test, chronological, random_state=42)",
        "date_range": f"{stage_result['start_date']} s/d {stage_result['end_date']}",
        "raw_hourly_records": stage_result["raw_hourly_records"],
        "products": all_evaluations,
    }
    hdfs_write_results["model_evaluation_json"] = hdfs.put_json(
        f"{GOLD_ROOT}/metrics/model_evaluation.json",
        evaluation_payload,
    )

    return {
        "status": "success",
        "message": (
            "Pipeline Bronze->Silver->Gold (XGBoost/RF/Ridge + SHAP) selesai "
            "dan seluruh output bersih berhasil ditulis ke Hadoop HDFS."
        ),
        "raw_hourly_records": stage_result["raw_hourly_records"],
        "daily_records": int(len(silver_df)),
        "start_date": stage_result["start_date"],
        "end_date": stage_result["end_date"],
        "next_adjustment_date": next_adj_date.isoformat(),
        "hdfs_writes": hdfs_write_results,
        "hdfs_connected": all(hdfs_write_results.values()),
        "synced_at": stage_result["ingested_at"],
    }


if __name__ == "__main__":
    client = HDFSClient()
    result = run_full_training_and_hdfs_export(client)
    print(result)
