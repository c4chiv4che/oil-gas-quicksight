-- curated_nag602_daily: daily gas quality compliance vs NAG-602 Tabla 1
-- ~180 rows from ~259k raw plant rows.
-- Powers the NAG-602 Compliance dashboard.
-- Excludes ESD windows (esd_phase = 'INACTIVE') so off-spec reflects
-- normal operation, not shutdown transients.
CREATE TABLE oil_gas_db.curated_nag602_daily
WITH (
  external_location = 's3://vaca-muerta-curated-919064997947/nag602_daily/',
  format = 'PARQUET',
  parquet_compression = 'SNAPPY'
) AS
SELECT
  date_trunc('day', "timestamp")                       AS day,
  pad_id,
  -- PCS (NAG-602: 8850-10200 kcal/m3)
  ROUND(MIN(ai_pcs), 1)                                AS pcs_min,
  ROUND(AVG(ai_pcs), 1)                                AS pcs_avg,
  ROUND(MAX(ai_pcs), 1)                                AS pcs_max,
  COUNT_IF(ai_pcs < 8850 OR ai_pcs > 10200)            AS pcs_off_spec_min,
  -- Wobbe (NAG-602: 11300-12470 kcal/m3)
  ROUND(MIN(ai_wobbe), 1)                              AS wobbe_min,
  ROUND(AVG(ai_wobbe), 1)                              AS wobbe_avg,
  ROUND(MAX(ai_wobbe), 1)                              AS wobbe_max,
  COUNT_IF(ai_wobbe < 11300 OR ai_wobbe > 12470)       AS wobbe_off_spec_min,
  -- Water content (NAG-602: < 65 mg/m3)
  ROUND(AVG(ai_h2o_fiscal), 1)                         AS h2o_avg,
  COUNT_IF(ai_h2o_fiscal > 65)                         AS h2o_off_spec_min,
  -- CO2 (NAG-602: < 2% molar)
  ROUND(AVG(ai_co2_fiscal), 3)                         AS co2_avg_pct,
  COUNT_IF(ai_co2_fiscal > 2.0)                        AS co2_off_spec_min,
  -- density for reference
  ROUND(AVG(ai_density), 4)                            AS density_avg,
  COUNT(*)                                             AS minutes_recorded
FROM oil_gas_db.plant
WHERE esd_phase = 'INACTIVE'
GROUP BY date_trunc('day', "timestamp"), pad_id
