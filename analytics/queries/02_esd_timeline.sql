-- 02_esd_timeline.sql
-- Confirm the injected ESD at 2026-03-15T14:00:00 (FIRE_GAS_HIGH, 6h)
-- produced the full phase sequence. Expected phases (in order):
--   DEPRESSURE → COMPRESSOR_TRIP → UTILITIES_DOWN → HOLD → RECOVERY
-- Each row reports how many minutes the plant spent in that phase on
-- 2026-03-15 along with the phase window. esd_reason should be
-- FIRE_GAS_HIGH for every non-INACTIVE row.
SELECT
  esd_phase,
  esd_reason,
  COUNT(*)           AS minutes_in_phase,
  MIN("timestamp")   AS phase_start,
  MAX("timestamp")   AS phase_end
FROM oil_gas_db.plant
WHERE esd_phase != 'INACTIVE'
  AND "timestamp" >= TIMESTAMP '2026-03-15 00:00:00'
  AND "timestamp" <  TIMESTAMP '2026-03-16 00:00:00'
GROUP BY esd_phase, esd_reason
ORDER BY phase_start;
