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
