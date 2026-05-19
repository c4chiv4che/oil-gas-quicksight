-- 04_nag602_compliance.sql
-- NAG-602 fiscal gas spec check across all non-SACADA minutes. Limits:
--   PCS   (kcal/m³): 8850-10200
--   Wobbe (kcal/m³): 11300-12470
--   H2O   (mg/m³):   < 65
-- Filter sacada_phase = 'INACTIVE' so transient ESD/depressurization
-- minutes do not pollute the spec stats. Expected: very low off-spec
-- counts when the plant is running normally.
SELECT
  COUNT(*)                                       AS total_minutes,
  COUNT_IF(ai_pcs < 8850 OR ai_pcs > 10200)      AS pcs_off_spec,
  COUNT_IF(ai_wobbe < 11300 OR ai_wobbe > 12470) AS wobbe_off_spec,
  COUNT_IF(ai_h2o_fiscal > 65)                   AS h2o_off_spec,
  ROUND(MIN(ai_pcs), 1)                          AS pcs_min,
  ROUND(MAX(ai_pcs), 1)                          AS pcs_max,
  ROUND(AVG(ai_pcs), 1)                          AS pcs_avg,
  ROUND(MIN(ai_wobbe), 1)                        AS wobbe_min,
  ROUND(MAX(ai_wobbe), 1)                        AS wobbe_max
FROM oil_gas_db.plant
WHERE sacada_phase = 'INACTIVE';
