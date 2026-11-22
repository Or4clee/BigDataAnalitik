# FuelPulse BI

**FuelPulse BI** adalah platform analitik **Big Data & Machine Learning** berbasis **Apache NiFi**, **Hadoop HDFS**, dan **Apache Spark** dengan total **>1,12 juta baris data per-jam riil (0% data sintetis)** untuk memprediksi harga keekonomian harian serta penyesuaian bulanan (setiap tanggal 1) **BBM Non-Subsidi Pertamina** di seluruh **38 provinsi Indonesia (PPN 11% + PBBKB 5%, 7,5%, 10%)**, lengkap dengan atribusi faktor historis **SHAP** dan **What-If Scenario Simulator**.

### Produk BBM Non-Subsidi yang Dianalisis
- **Pertamax (RON 92)**: Acuan utama `RB=F` (RBOB Gasoline Futures, proksi MOPS Mogas)
- **Pertamax Turbo (RON 98)**: Acuan utama `RB=F` (RBOB Gasoline Futures, proksi MOPS Mogas)
- **Dexlite (CN 51)**: Acuan utama `HO=F` (NY Harbor ULSD, proksi MOPS Gasoil)
- **Pertamina Dex (CN 53)**: Acuan utama `HO=F` (NY Harbor ULSD, proksi MOPS Gasoil)

### Volume Dataset Big Data Riil (Bronze HDFS)
- **Pasar Energi Global & Kurs (Yahoo Finance, 365 hari per-jam)**: `~27.019` baris (`RB=F`, `HO=F`, `BZ=F`, `CL=F`, `IDR=X`, `^OVX`).
- **Cuaca & Logistik Distribusi 125 Hub BBM di 38 Provinsi (Open-Meteo Archive, 365 hari x 24 jam)**: `1.095.000` baris riil (`temperature_2m`, `precipitation`, `wind_speed_10m`).
- **Total Observasi Riil Bronze HDFS**: **`1.122.019+` baris** (tersimpan dalam format kolumnar Apache Parquet di `/fuelpulse/staging/bronze_raw_hourly/`).

---

## Arsitektur End-to-End (Compute-Serving Decoupling)

```text
[1. Sumber Data Real (>1,12 Juta Baris)]  -->  [2. Ingestion: Apache NiFi 1.28.1]  -->  [3. HDFS Staging + Spark 3.5.1]
   Yahoo Finance (RB=F, HO=F, BZ=F,             ExecuteStreamCommand, EvaluateJsonPath,  /fuelpulse/staging/
   CL=F, IDR=X, ^OVX), pertamina_official.csv,  UpdateAttribute, PutHDFS                   bronze_raw_hourly/ (1.12M+)
   Open-Meteo Archive (125 hub x 365d x 24h)                                               silver_lag_features/ (Spark)
                                                                                                 |
                                                                                             (Parquet)
                                                                                                 v
[6. Serving & Web UI]                     <--  [5. Hadoop HDFS Clean Zone (:9870)]  <--  [4. Mesin ML & BI (Python)]
   FastAPI (WebHDFS) + Next.js                  /fuelpulse/gold_clean_analytics/           XGBoost vs RF vs Ridge (32 fitur)
   4 KPI, Forecast, SHAP, What-If,              predictions/, bi_attribution/,             SHAP TreeExplainer
   Matriks PBBKB 38 Provinsi                    metrics/, kpi_insights/, regional/         Kalibrasi ESDM (25-Day)
```

---

## Struktur Direktori Repositori

```text
BigDataProject/
├── nifi/
│   ├── fuelpulse_ingestion_flow.json    # Ekspor flow Apache NiFi 1.28.1 (RegisteredFlowSnapshot)
│   └── fetch_market_data.py             # Script pure-stdlib untuk ExecuteStreamCommand NiFi
├── hadoop/
│   ├── init_hdfs_dirs.sh                # Inisialisasi direktori /fuelpulse di Hadoop HDFS
│   └── spark_aggregate_1m.py            # Job Apache Spark 3.5.1 agregasi 1.095.000 baris Bronze HDFS
├── backend/
│   ├── data/
│   │   ├── pertamina_official.csv       # Referensi harga resmi DKI/Jawa (Nov 2025 - Nov 2026)
│   │   └── indonesia_fuel_hubs.csv      # 125 hub distribusi BBM di 38 provinsi + tarif PBBKB
│   ├── storage/
│   │   └── hdfs_client.py               # Klien WebHDFS (:9870) + fallback mirror lokal
│   ├── pipeline/
│   │   ├── regional_ingestion.py        # Ingestion 1.095.000 baris cuaca riil (125 hub x 365d x 24h)
│   │   └── transform.py                 # Bronze->Silver, konversi Rp/L, 32 fitur lag & ESDM 25-day
│   ├── ml/
│   │   ├── train.py                     # Komparasi XGBoost/RF/Ridge (80/20), PBBKB 38 prov & ekspor Gold
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
│   │   │   ├── WhatIfSimulator.tsx
│   │   │   └── RegionalPbbkbTable.tsx   # Tabel proyeksi 38 provinsi (PBBKB 5%, 7,5%, 10%) & cuaca hub
│   │   └── lib/api.ts                   # API client TypeScript menuju FastAPI
│   ├── DESIGN.md
│   ├── package.json
│   └── tailwind.config.ts
├── docs/
│   ├── generate_report.py               # Generator laporan otomatis berbasis metrik HDFS
│   └── Laporan_BigData_ML.pdf           # Laporan akhir proyek (5 poin wajib)
└── README.md
```

---

## Spesifikasi Kontrak API (FastAPI: `http://localhost:8000`)

| Endpoint | Metode | Parameter | Fungsi Utama |
| :--- | :--- | :--- | :--- |
| `/api/dashboard` | `GET` | `product` (`pertamax`, `pertamax_turbo`, `dexlite`, `pertamina_dex`) | Membaca file Parquet & JSON bersih (termasuk matriks PBBKB 38 provinsi) langsung dari Hadoop HDFS (`/fuelpulse/gold_clean_analytics/`) via WebHDFS (`127.0.0.1:9870`). |
| `/api/pipeline/sync` | `POST` | `force_refresh_regional` (opsional, default `false`) | Menjalankan pipeline *batch* Bronze->Silver->ML/SHAP (>1,12 juta baris) dan menulis seluruh keluaran bersih ke Hadoop HDFS. |
| `/api/simulate` | `POST` | JSON: `product`, `usd_idr`, `brent_usd` | Menjalankan inferensi simulasi skenario *What-If* secara instan (`< 500 ms`). |
| `/health` | `GET` | `-` | Status kesehatan FastAPI dan koneksi Hadoop WebHDFS. |

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
- Impor alur `nifi/fuelpulse_ingestion_flow.json` (format `RegisteredFlowSnapshot`) untuk menjalankan Visual ETL terjadwal menuju `/fuelpulse/staging/bronze_raw_hourly/`.

### 3. Menjalankan Backend FastAPI & Pipeline 1,12+ Juta Baris (Windows)
```bash
cd backend
pip install -r requirements.txt
python -m ml.train
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```
- **Swagger API Docs**: `http://localhost:8000/docs`

### 4. Agregasi Terdistribusi Apache Spark 3.5.1 (WSL Ubuntu)
```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export SPARK_HOME=$HOME/spark351
$SPARK_HOME/bin/spark-submit /mnt/c/BigDataProject/hadoop/spark_aggregate_1m.py
```

### 5. Menjalankan Frontend Next.js (Windows)
```bash
cd frontend
npm install
npm run dev
```
- **Dashboard Web**: `http://localhost:3000`
