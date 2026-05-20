-- curated_esd_events: one row per ESD phase occurrence
-- Collapses minute-level esd_phase into per-phase summary rows.
-- Powers the ESD Incident Analysis dashboard.
CREATE TABLE oil_gas_db.curated_esd_events
WITH (
  external_location = 's3://vaca-muerta-curated-919064997947/esd_events/',
  format = 'PARQUET',
  parquet_compression = 'SNAPPY'
) AS
WITH joined AS (
  SELECT
    p."timestamp"        AS ts,
    p.esd_phase,
    p.esd_reason,
    u.ft_flare_hp,
    u.tt_hotoil_supply
  FROM oil_gas_db.plant p
  JOIN oil_gas_db.utilities u
    ON p."timestamp" = u."timestamp"
  WHERE p.esd_phase <> 'INACTIVE'
)
SELECT
  esd_phase,
  esd_reason,
  COUNT(*)                          AS minutes_in_phase,
  MIN(ts)                           AS phase_start,
  MAX(ts)                           AS phase_end,
  ROUND(MAX(ft_flare_hp), 1)        AS peak_flare_hp_mm3d,
  ROUND(AVG(ft_flare_hp), 1)        AS avg_flare_hp_mm3d,
  ROUND(MIN(tt_hotoil_supply), 1)   AS min_hotoil_supply_c,
  ROUND(MAX(tt_hotoil_supply), 1)   AS max_hotoil_supply_c
FROM joined
GROUP BY esd_phase, esd_reason
