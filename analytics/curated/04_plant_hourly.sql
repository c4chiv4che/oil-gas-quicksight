-- curated_plant_hourly: hourly resample of key plant + flare signals
-- ~4,320 rows (180 days x 24h) from ~259k raw rows.
-- Powers trend charts (pressures, temps, flare) without scanning minute data.
CREATE TABLE oil_gas_db.curated_plant_hourly
WITH (
  external_location = 's3://vaca-muerta-curated-919064997947/plant_hourly/',
  format = 'PARQUET',
  parquet_compression = 'SNAPPY'
) AS
SELECT
  date_trunc('hour', p."timestamp")          AS hour,
  p.pad_id,
  -- plant pressures/temps (hourly average)
  ROUND(AVG(p.ai_pcs), 1)                    AS avg_pcs,
  ROUND(AVG(p.ai_wobbe), 1)                  AS avg_wobbe,
  ROUND(AVG(p.ai_density), 4)                AS avg_density,
  -- flare + hot oil from utilities
  ROUND(AVG(u.ft_flare_hp), 2)               AS avg_flare_hp,
  ROUND(MAX(u.ft_flare_hp), 1)               AS peak_flare_hp,
  ROUND(AVG(u.ft_flare_lp), 2)               AS avg_flare_lp,
  ROUND(AVG(u.tt_hotoil_supply), 1)          AS avg_hotoil_supply,
  ROUND(AVG(u.tt_flare_pilot), 1)            AS avg_flare_pilot,
  -- ESD activity flag for the hour
  COUNT_IF(p.esd_phase <> 'INACTIVE')        AS esd_minutes,
  COUNT(*)                                   AS minutes_recorded
FROM oil_gas_db.plant p
JOIN oil_gas_db.utilities u
  ON p."timestamp" = u."timestamp"
GROUP BY date_trunc('hour', p."timestamp"), p.pad_id
