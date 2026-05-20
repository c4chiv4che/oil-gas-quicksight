-- curated_well_daily: daily per-well aggregation
-- ~720 rows (180 days x 4 wells) from ~1M raw rows
-- Powers the Well Lifecycle dashboard without scanning minute-level data.
CREATE TABLE oil_gas_db.curated_well_daily
WITH (
  external_location = 's3://vaca-muerta-curated-919064997947/well_daily/',
  format = 'PARQUET',
  parquet_compression = 'SNAPPY'
) AS
SELECT
  date_trunc('day', "timestamp")           AS day,
  pad_id,
  well_id,
  -- production rates (daily average)
  ROUND(AVG(ft_oil), 2)                     AS avg_oil_m3d,
  ROUND(AVG(ft_gas), 2)                     AS avg_gas_mm3d,
  ROUND(AVG(ft_water), 2)                   AS avg_water_m3d,
  -- cumulative-ish proxies
  ROUND(AVG(ai_gor), 1)                     AS avg_gor,
  ROUND(AVG(ai_wcut) * 100, 2)              AS avg_wcut_pct,
  -- pressures
  ROUND(AVG(whp), 1)                        AS avg_whp_bar,
  ROUND(AVG(pt_downhole), 1)                AS avg_downhole_bar,
  -- ESP health
  ROUND(AVG(it_esp), 1)                     AS avg_esp_current_a,
  ROUND(AVG(vt_esp), 2)                     AS avg_esp_vibration,
  -- uptime: fraction of minutes actually producing
  ROUND(
    CAST(COUNT_IF(well_state = 'PRODUCING') AS DOUBLE) / COUNT(*) * 100, 1
  )                                         AS uptime_pct,
  -- dominant state of the day
  MAX_BY(well_state, 1)                     AS sample_state,
  COUNT(*)                                  AS minutes_recorded
FROM oil_gas_db.wells
GROUP BY date_trunc('day', "timestamp"), pad_id, well_id
