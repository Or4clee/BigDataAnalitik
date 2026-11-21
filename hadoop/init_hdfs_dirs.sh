#!/usr/bin/env bash
# FuelPulse BI — Inisialisasi Struktur Direktori Hadoop HDFS (/fuelpulse)
# Aman dijalankan berulang kali (mkdir -p), TIDAK memformat ulang NameNode.

set -euo pipefail

export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
export HADOOP_HOME="${HADOOP_HOME:-$HOME/hadoop336}"
export PATH="$PATH:$HADOOP_HOME/bin:$HADOOP_HOME/sbin"

echo "=== Memeriksa status NameNode & SafeMode ==="
hdfs dfsadmin -safemode wait

DIRS=(
  "/fuelpulse"
  "/fuelpulse/staging"
  "/fuelpulse/staging/bronze_raw_hourly"
  "/fuelpulse/staging/silver_lag_features"
  "/fuelpulse/gold_clean_analytics"
  "/fuelpulse/gold_clean_analytics/predictions"
  "/fuelpulse/gold_clean_analytics/bi_attribution"
  "/fuelpulse/gold_clean_analytics/metrics"
  "/fuelpulse/gold_clean_analytics/kpi_insights"
)

for dir in "${DIRS[@]}"; do
  echo "Membuat direktori HDFS: ${dir}"
  hdfs dfs -mkdir -p "${dir}"
done

hdfs dfs -chmod -R 777 /fuelpulse

echo "=== Struktur Direktori /fuelpulse di Hadoop HDFS ==="
hdfs dfs -ls -R /fuelpulse
