-- 01_overview.sql
-- Smoke check: how many rows per layer, and what date span they cover.
-- Expected: 3 rows (one per layer). For the canonical 180d/1min run the
-- counts should be in the millions and the min/max timestamps should span
-- roughly 2025-11-20 → 2026-05-19. Note the double-quoted "timestamp" —
-- it is a reserved word in Trino/Athena SQL.
SELECT 'wells'     AS layer, COUNT(*) AS row_count, MIN("timestamp") AS first_ts, MAX("timestamp") AS last_ts FROM oil_gas_db.wells
UNION ALL
SELECT 'plant',                COUNT(*),             MIN("timestamp"),             MAX("timestamp")           FROM oil_gas_db.plant
UNION ALL
SELECT 'utilities',            COUNT(*),             MIN("timestamp"),             MAX("timestamp")           FROM oil_gas_db.utilities
ORDER BY layer;
