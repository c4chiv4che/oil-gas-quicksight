-- 05_well_lifecycle.sql
-- Per well × state lifecycle breakdown: how many minutes each well spent
-- in each state, and the timestamp range of that state. Useful to:
--   - confirm IDLE/FLOWBACK/PRODUCING staggering across LLL-001..004
--   - verify the injected GAS_LOCK on LLL-002 (2026-04-10T08:00:00, ~3h)
--     shows up as GAS_LOCK minutes for that well only
--   - spot SAND_PLUG / HIGH_VIBRATION events emitted by the event engine
-- Expected: PRODUCING dominates; an early FLOWBACK bucket per well;
-- LLL-002 has a small GAS_LOCK bucket; no well is stuck in IDLE.
SELECT
  well_id,
  well_state,
  COUNT(*)           AS minutes_in_state,
  MIN("timestamp")   AS first_seen,
  MAX("timestamp")   AS last_seen
FROM oil_gas_db.wells
GROUP BY well_id, well_state
ORDER BY well_id, first_seen;
