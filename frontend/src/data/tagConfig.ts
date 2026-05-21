import type { StateLimits, ProcessState } from "../theme/theme";

/**
 * Central tag presentation/limits registry.
 *
 * The DATA layer keeps Athena snake_case column names; this module is
 * the bridge to operator-facing concerns: human label, engineering
 * unit, multi-state limits, and display precision. Adding a new tag
 * means adding an entry here — no symbol code changes.
 *
 * Two-tier limit model:
 *   - TagDef.limits is a GLOBAL DEFAULT (used when a tag varies little
 *     across wells, or as a fallback).
 *   - LIMITS_BY_WELL provides PER-WELL OVERRIDES for tags whose normal
 *     band shifts meaningfully between wells (production rates, WHP,
 *     CHP, downhole P).
 *
 * Always go through getLimits(tag, well) — never read .limits directly
 * from a symbol. That keeps the resolution rule in one place.
 */

export interface TagDef {
  label: string;
  unit: string;
  decimals: number;
  /** Global default; per-well entries in LIMITS_BY_WELL override this. */
  limits?: StateLimits;
}

export const TAGS: Record<string, TagDef> = {
  // Pressures and flowline temperature. Units per docs/SIMULATOR_SPEC.md §2.1.
  whp: {
    label: "WHP",
    unit: "bar",
    decimals: 0,
    // Per-well only; see LIMITS_BY_WELL.
  },
  chp: {
    label: "CHP",
    unit: "bar",
    decimals: 0,
    // Per-well only; see LIMITS_BY_WELL.
  },
  tt_flow: {
    // Renamed from "Flow temp": this is flowline (line) temperature, not a flow rate.
    label: "FLOWLINE TEMP",
    unit: "°C",
    decimals: 1,
    // Global: flowline temperature band is consistent across wells.
    limits: { loloLimit: 30, loLimit: 55, hiLimit: 75, hihiLimit: 90 },
  },

  // Production rates.
  ft_oil: {
    label: "Oil rate",
    unit: "m³/d",
    decimals: 1,
    // Per-well only; see LIMITS_BY_WELL.
  },
  ft_gas: {
    // ft_gas data is in thousands of std m³/day (kSm³/d). Note: simulator spec
    // mislabels this as "Mm³/d" — known doc bug (SIMULATOR_SPEC.md §2.1 and
    // simulator/src/wells.py:105), value is correct, label is not.
    label: "Gas rate",
    unit: "kSm³/d",
    decimals: 1,
    // Per-well only; see LIMITS_BY_WELL.
  },
  ft_water: {
    label: "Water rate",
    unit: "m³/d",
    decimals: 1,
    // Global: produced-water band is consistent across wells at this stage.
    limits: { loloLimit: 0.5, loLimit: 2, hiLimit: 6, hihiLimit: 10 },
  },
  pt_downhole: {
    label: "Downhole P",
    unit: "bar",
    decimals: 0,
    // Per-well only; see LIMITS_BY_WELL.
  },

  // Risk indices: dimensionless 0..1, higher is worse, no lo/lolo side.
  corrosion_risk: {
    label: "Corrosion risk",
    unit: "",
    decimals: 2,
    // TODO: tune (won't fire on 2026-03-15 dataset; corrosion max ~0.35 that day).
    // Wired for future datasets (e.g. 2026-04-10 GAS_LOCK scenario). Neutral
    // display on the current demo day is expected, not a bug.
    limits: { hiLimit: 0.6, hihiLimit: 0.85 },
  },
  hydrate_risk: {
    label: "Hydrate risk",
    unit: "",
    decimals: 2,
    // TODO: tune (constant 0.0 on 2026-03-15 dataset). Wired for future
    // datasets where hydrate margin tightens. Neutral display on the current
    // demo day is expected, not a bug.
    limits: { hiLimit: 0.5, hihiLimit: 0.8 },
  },
};

/**
 * Per-well limit overrides. Derived from p5/p95 of PRODUCING samples plus
 * SHUTDOWN floors, per well. Tags absent here fall back to TAGS[tag].limits.
 */
const LIMITS_BY_WELL: Record<string, Partial<Record<string, StateLimits>>> = {
  "LLL-001": {
    whp:         { loloLimit: 50,  loLimit: 115, hiLimit: 145, hihiLimit: 200 },
    chp:         { loloLimit: 20,  loLimit: 50,  hiLimit: 66,  hihiLimit: 90  },
    ft_oil:      { loloLimit: 5,   loLimit: 25,  hiLimit: 45,  hihiLimit: 70  },
    ft_gas:      { loloLimit: 2,   loLimit: 11,  hiLimit: 21,  hihiLimit: 30  },
    pt_downhole: { loloLimit: 150, loLimit: 280, hiLimit: 340, hihiLimit: 450 },
  },
  "LLL-002": {
    whp:         { loloLimit: 50,  loLimit: 125, hiLimit: 155, hihiLimit: 200 },
    chp:         { loloLimit: 20,  loLimit: 55,  hiLimit: 70,  hihiLimit: 90  },
    ft_oil:      { loloLimit: 5,   loLimit: 33,  hiLimit: 55,  hihiLimit: 70  },
    ft_gas:      { loloLimit: 2,   loLimit: 13,  hiLimit: 23,  hihiLimit: 30  },
    pt_downhole: { loloLimit: 150, loLimit: 300, hiLimit: 360, hihiLimit: 450 },
  },
  "LLL-003": {
    whp:         { loloLimit: 50,  loLimit: 125, hiLimit: 155, hihiLimit: 200 },
    chp:         { loloLimit: 20,  loLimit: 55,  hiLimit: 70,  hihiLimit: 90  },
    ft_oil:      { loloLimit: 5,   loLimit: 33,  hiLimit: 55,  hihiLimit: 70  },
    ft_gas:      { loloLimit: 2,   loLimit: 10,  hiLimit: 19,  hihiLimit: 28  },
    pt_downhole: { loloLimit: 150, loLimit: 300, hiLimit: 360, hihiLimit: 450 },
  },
  "LLL-004": {
    whp:         { loloLimit: 50,  loLimit: 128, hiLimit: 158, hihiLimit: 200 },
    chp:         { loloLimit: 20,  loLimit: 56,  hiLimit: 72,  hihiLimit: 90  },
    ft_oil:      { loloLimit: 5,   loLimit: 35,  hiLimit: 58,  hihiLimit: 75  },
    ft_gas:      { loloLimit: 2,   loLimit: 11,  hiLimit: 20,  hihiLimit: 28  },
    pt_downhole: { loloLimit: 150, loLimit: 305, hiLimit: 365, hihiLimit: 450 },
  },
};

/**
 * Resolves the effective StateLimits for a (tag, well) pair.
 *   1. Per-well override, if defined for this tag.
 *   2. Otherwise the tag's global default.
 *   3. Otherwise {} — evaluateState() with {} yields "normal" for any
 *      numeric value, which is the right behavior for tags without
 *      configured limits.
 */
export function getLimits(tag: string, well: string): StateLimits {
  const def = TAGS[tag];
  if (!def) return {};
  return LIMITS_BY_WELL[well]?.[tag] ?? def.limits ?? {};
}

/**
 * Categorical mapping for well_state. NOT a numeric tag, so it bypasses
 * evaluateState() entirely. SHUTDOWN is intentionally "stale" (greyed
 * out), not alarm — the well is not producing because operations
 * stopped it, not because something is failing in real time. A genuine
 * trip would be represented by a separate trip/alarm signal.
 */
export const WELL_STATE_TO_PROCESS: Record<string, ProcessState> = {
  PRODUCING: "normal",
  SHUTDOWN: "stale",
};
