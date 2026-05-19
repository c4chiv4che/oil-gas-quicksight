"""Static configuration: pad metadata, signal ranges, defaults."""

from __future__ import annotations

PAD_ID = "PAD-LLL-01"
FORMATION = "Vaca Muerta"
BASIN = "Neuquén"

WELL_IDS = ["LLL-001", "LLL-002", "LLL-003", "LLL-004"]

# first_production = start + offset_days. Yields a mix of lifecycle phases at default start.
WELL_OFFSETS_DAYS: dict[str, int] = {
    "LLL-001": -180,   # mature decline
    "LLL-002":  -60,   # plateau
    "LLL-003":  -15,   # mid-flowback
    "LLL-004":  +10,   # IDLE → FLOWBACK transition mid-sim
}

WELL_GEOMETRY: dict[str, dict[str, int]] = {
    "LLL-001": {"lateral_m": 2800, "stages": 45},
    "LLL-002": {"lateral_m": 3100, "stages": 50},
    "LLL-003": {"lateral_m": 2950, "stages": 48},
    "LLL-004": {"lateral_m": 3050, "stages": 49},
}

# Baseline gas composition per well (% molar; H2S & H2O are mg/m³).
# Slight per-well variation simulates field heterogeneity.
WELL_BASE_COMP: dict[str, dict[str, float]] = {
    "LLL-001": {"c1": 87.0, "c2": 7.5, "c3": 2.8, "c4": 0.9, "c5_plus": 0.5,
                "co2": 1.0, "n2": 1.2, "h2s": 1.2, "h2o": 220.0},
    "LLL-002": {"c1": 85.0, "c2": 8.5, "c3": 3.2, "c4": 1.0, "c5_plus": 0.6,
                "co2": 1.2, "n2": 1.3, "h2s": 2.5, "h2o": 260.0},
    "LLL-003": {"c1": 89.0, "c2": 6.0, "c3": 2.2, "c4": 0.7, "c5_plus": 0.4,
                "co2": 0.9, "n2": 1.4, "h2s": 0.8, "h2o": 300.0},
    "LLL-004": {"c1": 86.0, "c2": 8.0, "c3": 3.0, "c4": 1.1, "c5_plus": 0.6,
                "co2": 1.1, "n2": 1.5, "h2s": 1.8, "h2o": 200.0},
}

# Signal ranges per ISA 5.1 spec (§2-4).  noise_pct = gaussian sigma as fraction of value.
# Used by physics.add_noise and as soft clip bounds.
SIGNAL_RANGES: dict[str, dict[str, float]] = {
    # ── Wells §2.1 ───────────────────────────────────────────────────
    "WHP":          {"min": 20,   "max": 180, "noise": 0.005},
    "CHP":          {"min": 10,   "max": 80,  "noise": 0.007},
    "TT_FLOW":      {"min": 40,   "max": 95,  "noise": 0.003},
    "FT_OIL":       {"min": 0,    "max": 120, "noise": 0.02},
    "FT_GAS":       {"min": 0,    "max": 80,  "noise": 0.025},
    "FT_WATER":     {"min": 0,    "max": 30,  "noise": 0.015},
    "IT_ESP":       {"min": 40,   "max": 120, "noise": 0.008},
    "SI_ESP":       {"min": 35,   "max": 65,  "noise": 0.002},
    "ZT_CHOKE":     {"min": 0,    "max": 100, "noise": 0.001},
    "PT_DOWNHOLE":  {"min": 180,  "max": 420, "noise": 0.004},
    "AI_GOR":       {"min": 100,  "max": 800, "noise": 0.03},
    "AI_WCUT":      {"min": 0.02, "max": 0.45,"noise": 0.01},
    # §2.3 integrity
    "AI_SAND":      {"min": 0,    "max": 50,  "noise": 0.05},
    "VT_ESP":       {"min": 0,    "max": 7,   "noise": 0.05},
    "TT_ESP_OIL":   {"min": 60,   "max": 110, "noise": 0.005},
    # ── Plant §3.1 inlet manifold ───────────────────────────────────
    "PT_INLET":     {"min": 40,   "max": 70,  "sp": 55, "noise": 0.004},
    "TT_INLET":     {"min": 25,   "max": 60,  "noise": 0.005},
    "LT_SLUG":      {"min": 30,   "max": 70,  "sp": 50, "noise": 0.01},
    "FT_INLET_GAS": {"min": 0,    "max": 300, "noise": 0.01},
    "FT_INLET_LIQ": {"min": 0,    "max": 400, "noise": 0.01},
    # §3.2 separator
    "PT_SEP":       {"min": 8,    "max": 12,  "sp": 10,  "noise": 0.003},
    "TT_SEP":       {"min": 30,   "max": 50,  "noise": 0.004},
    "LT_SEP_OIL":   {"min": 40,   "max": 60,  "sp": 50,  "noise": 0.01},
    "LT_SEP_WATER": {"min": 30,   "max": 60,  "sp": 45,  "noise": 0.01},
    "PDT_SEP":      {"min": 50,   "max": 200, "noise": 0.01},
    # §3.3 TEG
    "TT_CONTACTOR": {"min": 35,   "max": 45,  "sp": 40, "noise": 0.003},
    "PT_CONTACTOR": {"min": 50,   "max": 70,  "noise": 0.004},
    "FT_TEG_CIRC":  {"min": 800,  "max": 1500,"noise": 0.01},
    "TT_REBOILER":  {"min": 195,  "max": 205, "sp": 200,"noise": 0.002},
    "AI_TEG_PURITY":{"min": 98.5, "max": 99.5,"noise": 0.001},
    "AI_DEWPOINT_H2O":{"min": -15,"max": -5,  "noise": 0.02},
    "LT_TEG_SURGE": {"min": 30,   "max": 80,  "noise": 0.01},
    # §3.4 LTS
    "TT_GAS_GAS":   {"min": 5,    "max": 15,  "noise": 0.01},
    "TT_CHILLER":   {"min": -20,  "max": -10, "sp": -15,"noise": 0.005},
    "PT_LTS":       {"min": 40,   "max": 60,  "noise": 0.004},
    "TT_LTS":       {"min": -18,  "max": -12, "noise": 0.005},
    "LT_LTS":       {"min": 30,   "max": 70,  "sp": 50, "noise": 0.01},
    "AI_DEWPOINT_HC":{"min":-10,  "max": -2,  "noise": 0.02},
    # §3.5 propane refrigeration
    "PT_PROP_SUCT": {"min": 1,    "max": 3,   "noise": 0.01},
    "PT_PROP_DISCH":{"min": 12,   "max": 16,  "noise": 0.005},
    "TT_PROP_SUCT": {"min": -25,  "max": -10, "noise": 0.01},
    "TT_PROP_DISCH":{"min": 70,   "max": 110, "noise": 0.005},
    "SI_PROP_COMP": {"min": 2800, "max": 3600,"noise": 0.002},
    "IT_PROP_COMP": {"min": 80,   "max": 200, "noise": 0.008},
    "VT_PROP_COMP": {"min": 0,    "max": 5,   "noise": 0.05},
    "LT_PROP_ACUM": {"min": 40,   "max": 80,  "noise": 0.01},
    # §3.6 stabilizer
    "PT_STAB":      {"min": 6,    "max": 10,  "noise": 0.004},
    "TT_STAB_TOP":  {"min": 50,   "max": 80,  "noise": 0.005},
    "TT_STAB_BOT":  {"min": 180,  "max": 220, "noise": 0.003},
    "FT_COND_OUT":  {"min": 0,    "max": 150, "noise": 0.02},
    "AI_RVP":       {"min": 8,    "max": 12,  "noise": 0.01},
    # §3.7 centrifugal compression
    "PT_COMP_SUCT": {"min": 55,   "max": 62,  "sp": 58.8,"noise": 0.002},
    "PT_COMP_DISCH":{"min": 60,   "max": 67,  "sp": 63.7,"noise": 0.002},
    "TT_COMP_SUCT": {"min": 30,   "max": 50,  "noise": 0.005},
    "TT_COMP_DISCH":{"min": 80,   "max": 130, "noise": 0.005},
    "SI_COMP":      {"min": 8000, "max": 12000,"noise": 0.002},
    "VT_COMP":      {"min": 0,    "max": 7,   "noise": 0.05},
    "ZT_ANTISURGE": {"min": 0,    "max": 100, "noise": 0.005},
    "FT_RECYCLE":   {"min": 0,    "max": 50,  "noise": 0.02},
    # §3.8 fiscal metering — NAG-602 limits
    "FQI_GAS_FISCAL":  {"min": 0,    "max": 300, "noise": 0.005},
    "FQI_COND_FISCAL": {"min": 0,    "max": 200, "noise": 0.01},
    "AI_PCS":          {"min": 8850, "max": 10200,"noise": 0.002},
    "AI_WOBBE":        {"min": 11300,"max": 12470,"noise": 0.002},
    "AI_DENSITY":      {"min": 0.58, "max": 0.70,"noise": 0.002},
    "AI_DEW_HC_FISCAL":{"min": -10,  "max": -4,  "noise": 0.02},
    "AI_H2O_FISCAL":   {"min": 0,    "max": 65,  "noise": 0.05},
    "AI_H2S_FISCAL":   {"min": 0,    "max": 3,   "noise": 0.05},
    "AI_S_TOTAL":      {"min": 0,    "max": 15,  "noise": 0.05},
    "AI_CO2_FISCAL":   {"min": 0,    "max": 2,   "noise": 0.02},
    "AI_O2_FISCAL":    {"min": 0,    "max": 0.2, "noise": 0.05},
    # ── Utilities §4.1 hot oil ─────────────────────────────────────
    "TT_HOTOIL_SUPPLY":{"min": 240, "max": 280, "sp": 260,"noise": 0.003},
    "TT_HOTOIL_RETURN":{"min": 180, "max": 220, "noise": 0.004},
    "PT_HOTOIL":       {"min": 3,   "max": 6,   "noise": 0.005},
    "FT_HOTOIL":       {"min": 30,  "max": 80,  "noise": 0.01},
    "TT_HEATER_STACK": {"min": 280, "max": 380, "noise": 0.005},
    "AI_O2_STACK":     {"min": 2,   "max": 6,   "noise": 0.02},
    "ZT_FUEL_VALVE":   {"min": 20,  "max": 90,  "noise": 0.01},
    # §4.2 instrument air
    "PT_IA_HEADER":    {"min": 6,   "max": 8,   "sp": 7,  "noise": 0.003},
    "TT_IA_DEWPOINT":  {"min": -60, "max": -40, "noise": 0.01},
    "LT_IA_ACCUM":     {"min": 50,  "max": 90,  "noise": 0.01},
    # §4.3 flare
    "FT_FLARE_HP":     {"min": 0,   "max": 200, "noise": 0.02},
    "FT_FLARE_LP":     {"min": 0,   "max": 50,  "noise": 0.02},
    "TT_FLARE_PILOT":  {"min": 600, "max": 900, "noise": 0.01},
    "PT_KO_DRUM":      {"min": 0.05,"max": 0.5, "noise": 0.02},
    "LT_KO_DRUM":      {"min": 0,   "max": 80,  "noise": 0.02},
    "QI_FLARE_SMOKE":  {"min": 0,   "max": 30,  "noise": 0.05},
}

# CLI defaults — smoke-test scale
DEFAULTS = {
    "days": 30,
    "freq": 5,                                    # minutes between samples
    "layers": "wells,plant,utilities",
    "upload": "none",                             # none | local | aws
    "output_dir": "../data/raw",
    "seed": 42,
    "sacada_duration_h": 4.0,
    "well_event_duration_h": (1.0, 6.0),          # GAS_LOCK 1-6h per spec §5.1
}

S3_BUCKETS = {
    "local": "vaca-muerta-raw",
    "aws":   "vaca-muerta-raw-919064997947",
}

S3_ENDPOINTS = {
    "local": "http://localhost:4566",
    "aws":   None,                                # default AWS endpoint
}
