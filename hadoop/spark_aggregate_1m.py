"""Apache Spark 3.5.1 job to verify and aggregate 1,095,000+ real hourly rows directly in Hadoop HDFS.

Run inside WSL Ubuntu:
  export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
  export SPARK_HOME=/home/abbyan/spark351
  $SPARK_HOME/bin/spark-submit /mnt/c/BigDataProject/hadoop/spark_aggregate_1m.py
"""

from __future__ import annotations

from pyspark.sql import SparkSession, functions as F

BRONZE_PATH = "hdfs://localhost:9000/fuelpulse/staging/bronze_raw_hourly/regional_logistics_weather_1m.parquet"
DAILY_OUT_PATH = "hdfs://localhost:9000/fuelpulse/staging/silver_lag_features/spark_daily_logistics_summary"
PROVINCE_OUT_PATH = "hdfs://localhost:9000/fuelpulse/staging/silver_lag_features/spark_provincial_summary"


def main() -> None:
    spark = (
        SparkSession.builder.appName("FuelPulseBI-Spark-1M-Aggregation")
        .master("local[4]")
        .config("spark.driver.memory", "2g")
        .getOrCreate()
    )
    spark.sparkContext.setLogLevel("WARN")

    df = spark.read.parquet(BRONZE_PATH)
    total_rows = df.count()
    n_hubs = df.select("hub_id").distinct().count()
    n_provinces = df.select("province").distinct().count()
    print(f"[Spark] Loaded Bronze Parquet from HDFS: {total_rows:,} rows | {n_hubs} hubs | {n_provinces} provinces")

    enriched = df.withColumn(
        "severe_hour",
        F.when((F.col("precipitation") >= 5.0) | (F.col("wind_speed_10m") >= 30.0), F.lit(1.0)).otherwise(F.lit(0.0)),
    )

    daily_summary = (
        enriched.groupBy("date")
        .agg(
            F.avg("temperature_2m").alias("nat_temp_mean_c"),
            F.sum("precipitation").alias("total_hourly_precip_mm"),
            F.max("wind_speed_10m").alias("nat_wind_max_kmh"),
            (F.avg("severe_hour") * 100.0).alias("logistics_disruption_idx"),
            F.count("*").alias("hourly_rows_processed"),
        )
        .orderBy("date")
    )
    daily_summary.write.mode("overwrite").parquet(DAILY_OUT_PATH)

    prov_summary = (
        enriched.groupBy("province", "region_group", "pbbkb_rate")
        .agg(
            F.countDistinct("hub_id").alias("hubs_count"),
            F.count("*").alias("hourly_observations"),
            F.round(F.avg("temperature_2m"), 1).alias("avg_temp_c"),
            F.round(F.max("wind_speed_10m"), 1).alias("max_wind_kmh"),
            F.round(F.avg("severe_hour") * 100.0, 2).alias("severe_weather_pct"),
        )
        .orderBy("pbbkb_rate", "province")
    )
    prov_summary.write.mode("overwrite").parquet(PROVINCE_OUT_PATH)

    print(f"[Spark] Wrote daily summary ({daily_summary.count()} days) and provincial summary ({prov_summary.count()} provinces) to HDFS.")
    spark.stop()


if __name__ == "__main__":
    main()
