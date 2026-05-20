-- 03_flare_during_esd.sql
-- Cross-layer behavior during the ESD window
-- (2026-03-15T14:00:00 → 2026-03-15T20:00:00, 6h):
--   - HP flare (ft_flare_hp) should spike as plant inventory depressurizes.
--   - Hot-oil supply temperature (tt_hotoil_supply) should drop below the
--     normal 240–280°C band as the heater shuts down.
-- Expected: a single summary row with flare_hp_max well above baseline
-- (>50 Mm³/d) and hotoil_supply_min noticeably under 240°C.
SELECT
  COUNT(*)                            AS minutes_in_window,
  ROUND(MIN(ft_flare_hp), 2)          AS flare_hp_min,
  ROUND(MAX(ft_flare_hp), 2)          AS flare_hp_max,
  ROUND(AVG(ft_flare_hp), 2)          AS flare_hp_avg,
  ROUND(MIN(tt_hotoil_supply), 2)     AS hotoil_supply_min,
  ROUND(MAX(tt_hotoil_supply), 2)     AS hotoil_supply_max,
  ROUND(AVG(tt_hotoil_supply), 2)     AS hotoil_supply_avg
FROM oil_gas_db.utilities
WHERE "timestamp" >= TIMESTAMP '2026-03-15 14:00:00'
  AND "timestamp" <  TIMESTAMP '2026-03-15 20:00:00';
