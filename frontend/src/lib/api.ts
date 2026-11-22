/** FuelPulse BI TypeScript API client & shared response types. */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type ProductKey =
  | "pertamax"
  | "pertamax_turbo"
  | "dexlite"
  | "pertamina_dex";

export interface ProductTabMeta {
  key: ProductKey;
  label: string;
  spec: string;
  benchmark: string;
  category: "gasoline" | "diesel";
}

export const PRODUCT_TABS: ProductTabMeta[] = [
  {
    key: "pertamax",
    label: "Pertamax",
    spec: "RON 92",
    benchmark: "RBOB Gasoline (RB=F)",
    category: "gasoline",
  },
  {
    key: "pertamax_turbo",
    label: "Pertamax Turbo",
    spec: "RON 98",
    benchmark: "RBOB Gasoline (RB=F)",
    category: "gasoline",
  },
  {
    key: "dexlite",
    label: "Dexlite",
    spec: "CN 51",
    benchmark: "NY Harbor ULSD (HO=F)",
    category: "diesel",
  },
  {
    key: "pertamina_dex",
    label: "Pertamina Dex",
    spec: "CN 53",
    benchmark: "NY Harbor ULSD (HO=F)",
    category: "diesel",
  },
];

export interface HDFSStatus {
  connected: boolean;
  namenode_ui: string;
  webhdfs_url: string;
  clean_zone: string;
  mode: string;
  error: string | null;
}

export interface ModelMetrics {
  best_model: string;
  mae_idr: number;
  rmse_idr: number;
  r2_score: number;
}

export interface ModelComparisonRow {
  model: string;
  mae_idr: number;
  rmse_idr: number;
  r2_score: number;
}

export interface BronzeBreakdown {
  market_hourly_rows: number;
  regional_weather_hourly_rows: number;
  total_bronze_hourly_rows: number;
  hubs_count: number;
  provinces_count: number;
}

export interface RegionalPriceRow {
  province: string;
  region_group: string;
  pbbkb_pct: number;
  hubs_count: number;
  hourly_observations: number;
  official_price_prov: number;
  economic_parity_prov: number;
  predicted_next_month_prov: number;
  delta_idr_prov: number;
  status: "NAIK" | "TURUN" | "STABIL";
  avg_temp_c: number;
  annual_rain_per_hub_mm: number;
  max_wind_kmh: number;
  severe_weather_pct: number;
}

export interface DashboardMetadata {
  product_key: ProductKey;
  product_name: string;
  spec: string;
  category: "gasoline" | "diesel";
  benchmark_label: string;
  benchmark_ticker: string;
  region: string;
  start_date: string;
  end_date: string;
  date_range: string;
  raw_hourly_records: number;
  bronze_breakdown?: BronzeBreakdown;
  daily_records: number;
  train_records: number;
  test_records: number;
  series_counts: Record<string, number>;
  last_synced_at: string;
  latest_usd_idr: number;
  latest_brent_usd: number;
}

export interface DashboardKpi {
  current_official_price: number;
  today_economic_parity: number;
  parity_gap_idr: number;
  next_month_prediction: number;
  next_adjustment_date: string;
  delta_idr: number;
  status: "NAIK" | "TURUN" | "STABIL";
  model_metrics: ModelMetrics;
}

export interface AttributionFactor {
  factor: string;
  feature_key: string;
  lag_window: string;
  importance_pct: number;
  shap_impact_idr: number;
}

export interface ForecastPoint {
  date: string;
  official_price: number | null;
  economic_parity: number | null;
  predicted_price: number;
  forecast_line: number | null;
  is_forecast: boolean;
  horizon: string | null;
}

export interface DashboardResponse {
  source_storage: string;
  hdfs_status: HDFSStatus;
  metadata: DashboardMetadata;
  kpi: DashboardKpi;
  bi_lag_attribution: AttributionFactor[];
  time_series: ForecastPoint[];
  regional_prices?: RegionalPriceRow[];
  model_comparison: ModelComparisonRow[];
  insights: string[];
}

export interface SyncResponse {
  status: string;
  message: string;
  raw_hourly_records: number;
  daily_records: number;
  start_date: string;
  end_date: string;
  next_adjustment_date: string;
  hdfs_connected: boolean;
  synced_at: string;
}

export interface SimulateRequest {
  product: ProductKey;
  usd_idr: number;
  brent_usd: number;
}

export interface SimulateResponse {
  product: ProductKey;
  product_name: string;
  assumed_usd_idr: number;
  assumed_brent_usd: number;
  baseline_usd_idr: number;
  baseline_brent_usd: number;
  current_official_price: number;
  baseline_parity_price: number;
  simulated_parity_price: number;
  simulated_retail_price: number;
  delta_vs_official_idr: number;
  delta_vs_baseline_idr: number;
  status: "NAIK" | "TURUN" | "STABIL";
  model_used: string;
  inference_ms: number;
}

export async function fetchDashboard(
  product: ProductKey
): Promise<DashboardResponse> {
  const res = await fetch(
    `${API_BASE_URL}/api/dashboard?product=${encodeURIComponent(product)}`,
    { cache: "no-store" }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

export async function triggerPipelineSync(): Promise<SyncResponse> {
  const res = await fetch(`${API_BASE_URL}/api/pipeline/sync`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sinkronisasi gagal (HTTP ${res.status}): ${body}`);
  }
  return res.json();
}

export async function runWhatIfSimulation(
  payload: SimulateRequest
): Promise<SimulateResponse> {
  const res = await fetch(`${API_BASE_URL}/api/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Simulasi gagal (HTTP ${res.status}): ${body}`);
  }
  return res.json();
}
