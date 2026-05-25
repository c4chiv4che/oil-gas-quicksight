/**
 * theme.ts — TS mirror of the HMI token system (theme.css).
 *
 * Why it exists: uPlot and any color computation in JS CANNOT read CSS
 * variables. This module provides the hex values directly for those cases.
 *
 * RULE: theme.css is the source of truth for RENDERING (what the DOM
 * shows). theme.ts is for JS that needs the raw value (trends, canvas).
 * If you change a color, change it in BOTH — or better, read it via
 * getComputedStyle when possible (readCssVar helper below).
 */

export type HmiThemeName = "isa101" | "high-contrast";

/** Process states. Order matters: increasing severity. */
export type ProcessState = "normal" | "stale" | "warn" | "alarm";

/** Palette per mode. Mirrors the theme.css blocks. */
export const THEMES: Record<HmiThemeName, Record<string, string>> = {
  isa101: {
    bg: "#1a1d21",
    surface: "#20242a",
    surface2: "#181b1f",
    header: "#23272e",
    border: "#2e333b",
    border2: "#3d4450",
    text: "#d4d8dd",
    textMuted: "#8b919a",
    stateNormal: "#d4d8dd",
    stateStale: "#6b7280",
    stateWarn: "#e8a317",
    stateAlarm: "#ff5b5b",
    traceA: "#4a9eff",
    traceB: "#e8a317",
    accent: "#4a9eff",
    cursor: "#c8ccd2",
  },
  "high-contrast": {
    bg: "#0a1018",
    surface: "#0e1826",
    surface2: "#0a1322",
    header: "#0f2138",
    border: "#1c3050",
    border2: "#2f5a8f",
    text: "#e6eef9",
    textMuted: "#7f97b8",
    stateNormal: "#35c46b",
    stateStale: "#5a6678",
    stateWarn: "#ffc02e",
    stateAlarm: "#ff4d4d",
    traceA: "#2f9bff",
    traceB: "#21d4a8",
    accent: "#1e6feb",
    cursor: "#ff4d4d",
  },
};

/** Glyph per state, for DUAL encoding (ISA-101: never color alone). */
export const STATE_GLYPH: Record<ProcessState, string> = {
  normal: "",
  stale: "○",
  warn: "◆",
  alarm: "●",
};

/**
 * Tag limits to evaluate multi-state.
 * Convention: lo > hi defines the normal band. Outside it => warn or
 * alarm depending on the "lolo"/"hihi" (critical) limits if defined.
 *
 *   value < loloLimit  or  value > hihiLimit  => "alarm"
 *   value < loLimit    or  value > hiLimit    => "warn"
 *   within band                                => "normal"
 *
 * Any limit can be omitted (undefined = no check on that side).
 */
export interface StateLimits {
  loloLimit?: number;
  loLimit?: number;
  hiLimit?: number;
  hihiLimit?: number;
}

/**
 * Derives the process state of a numeric value from its limits.
 * THIS is the single source of truth for multi-state: every symbol
 * calls it, none reimplements the logic.
 *
 * null/undefined/NaN value => "stale" (missing data, NOT alarm).
 */
export function evaluateState(
  value: number | null | undefined,
  limits: StateLimits = {}
): ProcessState {
  if (value == null || Number.isNaN(value)) return "stale";
  const { loloLimit, loLimit, hiLimit, hihiLimit } = limits;
  if (loloLimit != null && value < loloLimit) return "alarm";
  if (hihiLimit != null && value > hihiLimit) return "alarm";
  if (loLimit != null && value < loLimit) return "warn";
  if (hiLimit != null && value > hiLimit) return "warn";
  return "normal";
}

/** Reads a CSS variable at runtime (preferred when the mode can change). */
export function readCssVar(name: string, el: HTMLElement = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** Hex color of a state, for the given mode (use in JS/uPlot). */
export function stateColor(state: ProcessState, theme: HmiThemeName): string {
  const t = THEMES[theme];
  switch (state) {
    case "normal": return t.stateNormal;
    case "stale":  return t.stateStale;
    case "warn":   return t.stateWarn;
    case "alarm":  return t.stateAlarm;
  }
}

/** A contiguous zone of constant state on a value scale. Boundaries are
 *  inclusive on the low side / exclusive on the high side; `state` is
 *  decided by evaluateState() at the segment midpoint so missing limits
 *  collapse naturally without per-case branching. */
export interface Zone {
  state: ProcessState;
  from: number;
  to: number;
}

/**
 * Builds the colored zones of a value scale from the tag's limits.
 *
 * Each boundary (0, lolo, lo, hi, hihi, scaleMax) that falls inside
 * [0, scaleMax] becomes a segment edge; the segment's state is decided
 * by evaluateState() at its midpoint. That keeps any visual (gauge arc,
 * trend band) in lockstep with the state classification, and tags with
 * missing limits (e.g. only hi/hihi) collapse to fewer segments without
 * dedicated branches.
 *
 * Shared by GaugeSymbol (radial arc) and TrendSymbol (background bands).
 * If you change the zone logic, both surfaces update together — that is
 * the whole point of keeping this here.
 */
export function buildZones(limits: StateLimits, scaleMax: number): Zone[] {
  const candidates: number[] = [
    0,
    limits.loloLimit,
    limits.loLimit,
    limits.hiLimit,
    limits.hihiLimit,
    scaleMax,
  ].filter((v): v is number => typeof v === "number");

  const sorted = candidates
    .filter((v) => v >= 0 && v <= scaleMax)
    .sort((a, b) => a - b);

  const unique: number[] = [];
  for (const v of sorted) {
    if (unique.length === 0 || v - unique[unique.length - 1] > 1e-9) {
      unique.push(v);
    }
  }
  if (unique.length < 2) return [];

  const zones: Zone[] = [];
  for (let i = 0; i < unique.length - 1; i++) {
    const a = unique[i];
    const b = unique[i + 1];
    const mid = (a + b) / 2;
    zones.push({ state: evaluateState(mid, limits), from: a, to: b });
  }
  return zones;
}

/** Round x UP to a "nice" axis bound. 77 → 80, 33 → 40, 7.7 → 8. Keeps ticks
 *  legible without forcing huge headroom (avoids the snapNumY 33→50 jump).
 */
function niceCeil(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return x;
  const exp = Math.floor(Math.log10(x));
  const pow = Math.pow(10, exp);
  const norm = x / pow;
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  for (const s of steps) {
    if (norm <= s + 1e-9) return s * pow;
  }
  return 10 * pow;
}

/**
 * Upper bound of a value scale, derived from a tag's hihi limit with 10%
 * headroom rounded to a "nice" axis bound.
 *
 * The headroom is what makes the alarm zone VISIBLE on a fixed scale: with
 * a top of exactly hihi, buildZones() produces no segment above hihi, so a
 * radial arc has no red band and the needle just pins at the dial extreme.
 * Topping out at hihi*1.1 instead gives buildZones() a (hihi, scaleMax]
 * span it classifies as "alarm" — the needle/trace crosses INTO red past
 * hihi.
 *
 * Single source of truth for GaugeSymbol (radial arc top) and TrendSymbol
 * (axis max): the 1.1 factor is deliberately the SAME for both so the gauge
 * and trend of one tag share one scale. Change it here and both move
 * together — that consistency is worth more than a fatter red band on
 * either surface alone.
 */
export function scaleMaxFor(hihiLimit: number): number {
  return niceCeil(hihiLimit * 1.1);
}
