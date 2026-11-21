# FuelPulse BI

**FuelPulse BI** adalah platform analitik **Big Data & Machine Learning** berbasis **Apache NiFi** dan **Hadoop HDFS** untuk memprediksi harga keekonomian harian serta penyesuaian bulanan (setiap tanggal 1) **BBM Non-Subsidi Pertamina** di wilayah **DKI Jakarta & Pulau Jawa (PPN 11% + PBBKB 5%)**, lengkap dengan atribusi faktor historis **SHAP** dan **What-If Scenario Simulator**.

### Produk BBM Non-Subsidi yang Dianalisis
- **Pertamax (RON 92)** — Acuan utama: `RB=F` (RBOB Gasoline Futures — proksi MOPS Mogas)
- **Pertamax Turbo (RON 98)** — Acuan utama: `RB=F` (RBOB Gasoline Futures — proksi MOPS Mogas)
- **Dexlite (CN 51)** — Acuan utama: `HO=F` (NY Harbor ULSD — proksi MOPS Gasoil)
- **Pertamina Dex (CN 53)** — Acuan utama: `HO=F` (NY Harbor ULSD — proksi MOPS Gasoil)

---

## Arsitektur End-to-End (Compute–Serving Decoupling)

```text
[1. Sumber Data Real (365 Hari)]  ──▶  [2. Ingestion: Apache NiFi 1.28.1]  ──▶  [3. HDFS Data Lake Staging]
   Yahoo Finance (RB=F, HO=F,           ExecuteStreamCommand, EvaluateJsonPath,  /fuelpulse/staging/
   BZ=F, CL=F, IDR=X, ^OVX) &           UpdateAttribute, PutHDFS                   bronze_raw_hourly/
   pertamina_official.csv                                                          silver_lag_features/
                                                                                         │
                                                                                     (Parquet)
                                                                                         ▼
[6. Serving & Web UI]             ◀──  [5. Hadoop HDFS Clean Zone (:9870)]  ◀──  [4. Mesin ML & BI (Python)]
   FastAPI (WebHDFS) + Next.js          /fuelpulse/gold_clean_analytics/           XGBoost vs RF vs Ridge
   4 KPI, Forecast, SHAP, What-If       predictions/, bi_attribution/,             SHAP TreeExplainer
                                        metrics/, kpi_insights/                    Kalibrasi ESDM (25-Day)
```

---

## Struktur Direktori Repositori

```text
BigDataProject/
├── nifi/
│   ├── fuelpulse_ingestion_flow.json    # Ekspor flow Apache NiFi 1.28.1 (Visual ETL + PutHDFS)
│   └── fetch_market_data.py             # Script pure-stdlib untuk ExecuteStreamCommand NiFi
├── hadoop/
│   └── init_hdfs_dirs.sh                # Inisialisasi direktori /fuelpulse di Hadoop HDFS
├── backend/
│   ├── data/
│   │   └── pertamina_official.csv       # Referensi harga resmi DKI/Jawa (Nov 2025 – Nov 2026)
│   ├── storage/
│   │   └── hdfs_client.py               # Klien WebHDFS (:9870) + fallback mirror lokal
│   ├── pipeline/
│   │   └── transform.py                 # Bronze->Silver, konversi Rp/L, lag H-1..H-30 & ESDM 25-day
│   ├── ml/
│   │   ├── train.py                     # Komparasi XGBoost/RF/Ridge (80/20 split) & ekspor Gold HDFS
│   │   └── explain.py                   # Ekstraksi SHAP TreeExplainer, Auto-Insights & What-If (<500ms)
│   ├── main.py                          # Entry point FastAPI (membaca data bersih dari Hadoop HDFS)
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx                 # Dashboard utama FuelPulse BI
│   │   ├── components/
│   │   │   ├── KpiCards.tsx
│   │   │   ├── ForecastChart.tsx
│   │   │   ├── AttributionChart.tsx
│   │   │   └── WhatIfSimulator.tsx
│   │   └── lib/api.ts                   # API client TypeScript menuju FastAPI
│   ├── package.json
│   └── tailwind.config.ts
├── docs/
│   ├── generate_report.py               # Generator laporan otomatis berbasis metrik HDFS
│   └── Laporan_BigData_ML.pdf           # Laporan akhir proyek (5 poin wajib)
└── README.md
```

---

## Spesifikasi Kontrak API (FastAPI — `http://localhost:8000`)

| Endpoint | Metode | Parameter | Fungsi Utama |
| :--- | :--- | :--- | :--- |
| `/api/dashboard` | `GET` | `product` (`pertamax`, `pertamax_turbo`, `dexlite`, `pertamina_dex`) | Membaca file Parquet & JSON bersih langsung dari Hadoop HDFS (`/fuelpulse/gold_clean_analytics/`) via WebHDFS (`localhost:9870`). |
| `/api/pipeline/sync` | `POST` | — | Menjalankan pipeline *batch* Bronze→Silver→ML/SHAP dan menulis seluruh keluaran bersih ke Hadoop HDFS. |
| `/api/simulate` | `POST` | JSON: `product`, `usd_idr`, `brent_usd` | Menjalankan inferensi simulasi skenario *What-If* secara instan (`< 500 ms`). |
| `/health` | `GET` | — | Status kesehatan FastAPI dan koneksi Hadoop WebHDFS. |

---

## Panduan Instalasi & Menjalankan Sistem

### 1. Menyalakan Hadoop HDFS & Inisialisasi `/fuelpulse` (WSL Ubuntu)
```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export HADOOP_HOME=~/hadoop336
export PATH=$PATH:$HADOOP_HOME/bin:$HADOOP_HOME/sbin

$HADOOP_HOME/sbin/start-dfs.sh
bash /mnt/c/BigDataProject/hadoop/init_hdfs_dirs.sh
```
- **NameNode Web UI**: `http://localhost:9870`
- **HDFS RPC**: `hdfs://localhost:9000`

### 2. Menyalakan Apache NiFi (WSL Ubuntu)
```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
/opt/nifi/bin/nifi.sh start
```
- **NiFi UI**: `https://127.0.0.1:8443/nifi`
- Impor alur `nifi/fuelpulse_ingestion_flow.json` untuk menjalankan Visual ETL terjadwal menuju `/fuelpulse/staging/bronze_raw_hourly/`.

### 3. Menjalankan Backend FastAPI (Windows)
```bash
cd backend
pip install -r requirements.txt
python -m ml.train
python -m uvicorn main:app --reload --port 8000
```
- **Swagger API Docs**: `http://localhost:8000/docs`

### 4. Menjalankan Frontend Next.js (Windows)
```bash
cd frontend
npm install
npm run dev
```
- **Dashboard Web**: `http://localhost:3000`
