# MacroAgri-BI Pulse

**MacroAgri-BI Pulse** adalah aplikasi analitik berbasis **Big Data** dan **Machine Learning** yang mengintegrasikan observasi cuaca resolusi per-jam dari **Open-Meteo API** dengan indikator pasar makroekonomi dan komoditas pangan harian dari **Yahoo Finance API** selama **365 hari terakhir** ke dalam format penyimpanan kolumnar **Apache Parquet**.

Aplikasi ini menyediakan dua kapabilitas analitik terpadu dalam satu dasbor interaktif **Next.js + Recharts**:
1. **Explanatory Business Intelligence (Atribusi Faktor Masa Lampau):** Mengukur persentase kontribusi faktor historis (`H−1`, `H−3`, `H−7`, `H−14`, serta *rolling window* 7 hari) terhadap nilai indeks pangan hari ini ($t_0$).
2. **Predictive Analytics (Peramalan H+7):** Memproyeksikan pergerakan indeks komoditas pangan (`ICBP.JK`) untuk 7 hari ke depan (`H+1` hingga `H+7`) menggunakan **Random Forest Regressor** tanpa kebocoran data masa depan (*no data leakage*).

---

## Arsitektur & Struktur Repositori

```text
macroagri-bi-pulse/
├── backend/
│   ├── data/
│   │   └── processed/
│   │       └── macro_agri_1yr.parquet   # Dataset Big Data 365 hari terintegrasi
│   ├── main.py                          # FastAPI Server, Data Pipeline & ML Engine
│   └── requirements.txt                 # Daftar pustaka Python
├── frontend/
│   ├── src/app/
│   │   ├── page.tsx                     # Komponen utama dasbor Next.js + Recharts
│   │   ├── layout.tsx                   # Tata letak global aplikasi
│   │   └── globals.css                  # Konfigurasi Tailwind CSS
│   ├── package.json                     # Konfigurasi dependensi Node.js
│   ├── tsconfig.json                    # Konfigurasi TypeScript
│   ├── next.config.ts                   # Konfigurasi Next.js
│   └── tailwind.config.ts               # Konfigurasi utilitas gaya tampilan
└── README.md                            # Dokumentasi instalasi & cara menjalankan
```

---

## Sumber Data, Harmonisasi & Feature Engineering

### 1. Sumber Data Real (365 Hari Terakhir)
- **Open-Meteo Historical/Forecast API** *(Per-jam / ~8.760 baris per tahun, koordinat sentra pangan Pantura Jawa Barat `-6.32, 107.76`)*:
  - `temperature_2m` (Suhu udara)
  - `precipitation` (Curah hujan)
  - `relative_humidity_2m` (Kelembapan udara)
  - `soil_moisture_0_to_7cm` (Kelembapan tanah)
- **Yahoo Finance Market API** *(Harian hari bursa aktif)*:
  - `IDR=X` — Kurs USD/IDR
  - `BZ=F` — Harga Minyak Mentah Brent
  - `ICBP.JK` — Indeks Sektor/Komoditas Pangan (Target Prediksi)

### 2. Pemrosesan & Penyimpanan Kolumnar
- Data cuaca per-jam diagregasi ke metrik harian (`temp_mean`, `temp_max`, `precip_sum`, `humidity_mean`, `soil_moisture_mean`).
- Kalender harian 365 hari diselaraskan dengan metode **Forward Fill (`ffill`)** (serta `bfill` untuk awal rentang) guna menangani hari libur bursa sehingga dataset bebas nilai `NaN`.
- Fitur historis dibentuk pada jeda **H−1, H−3, H−7, dan H−14** untuk Kurs USD/IDR, Harga Minyak Brent, Curah Hujan, Suhu Maksimum, Kelembapan Tanah, dan Kelembapan Udara, ditambah *rolling window* 7 hari (`rain_7d_sum` & `usd_idr_7d_mean`) yang digeser 1 hari ke belakang agar bebas *data leakage*.
- Dataset bersih disimpan ke `backend/data/processed/macro_agri_1yr.parquet` untuk caching cepat (`< 2 detik`).

### 3. Pemodelan Machine Learning
- **Algoritma:** `RandomForestRegressor(n_estimators=200, random_state=42)`
- **Pembagian Data:** **85% latih / 15% uji secara kronologis** (tanpa pengacakan urutan waktu).
- **Evaluasi:** `Mean Absolute Error (MAE)` dan `Root Mean Squared Error (RMSE)` pada himpunan uji.
- **Atribusi BI:** Ekstraksi `feature_importances_` menjadi **8 faktor historis teratas (%)**.
- **Forecasting H+7:** Proyeksi iteratif 7 hari ke depan dengan menggeser nilai historis terbaru ke dalam jendela *lag* secara kronologis.

---

## Spesifikasi Endpoint API (FastAPI)

| Endpoint | Metode | Deskripsi |
| :--- | :--- | :--- |
| `/api/dashboard` | `GET` | Endpoint terpadu berisi `metadata`, `bi_lag_attribution` (Top 8), dan `time_series` (30 hari aktual + H+7 proyeksi). |
| `/api/pipeline/sync` | `POST` | Menarik ulang data 365 hari terakhir dari Open-Meteo & Yahoo Finance, memperbarui berkas Parquet, dan melatih ulang model. |
| `/api/bi/attribution` | `GET` | Mengembalikan daftar 8 faktor historis paling berpengaruh (`factor`, `importance_pct`). |
| `/api/ml/predict` | `GET` | Mengembalikan deret waktu aktual vs prediksi beserta skor `mae` dan `rmse`. |
| `/health` | `GET` | Healthcheck status layanan API. |

---

## Cara Instalasi & Menjalankan Aplikasi

### Prasyarat
- **Python 3.10+**
- **Node.js 20+** & **npm**

### 1. Menjalankan Backend (FastAPI)
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```
Backend akan berjalan di `http://localhost:8000` (dokumentasi interaktif Swagger tersedia di `http://localhost:8000/docs`).

### 2. Menjalankan Frontend (Next.js)
Buka terminal baru pada direktori root proyek:
```bash
cd frontend
npm install
npm run dev
```
Dasbor web dapat diakses melalui browser di `http://localhost:3000`.
*(Opsional: atur `NEXT_PUBLIC_API_URL` jika backend berjalan di host/port berbeda).*
