/**
 * useActiveEsdPhase — shared source of truth for "is an ESD running
 * right now, and which phase is it in?", derived from simTime + the
 * cached esd_events.json.
 *
 * This hook centralizes the small amount of logic that both the live
 * EventsTable log and the EsdBanner need to agree on; future displays
 * (Overview ESD markers, a future ESD sequence panel) consume the same
 * hook and stay automatically in sync.
 *
 * Re-render contract — same trick EventsTable used inline before:
 * every value exposed is derived inside a primitive Zustand selector,
 * so the component only re-renders when the value actually changes,
 * not on every rAF tick that bumps simTime. In particular `elapsedMs`
 * is intentionally NOT exposed — `elapsedMinutes` is quantized to a
 * minute boundary inside the selector, which is the resolution the UI
 * actually wants and which keeps the re-render budget low (~1×/min
 * during an ESD, 0 outside it).
 */

import { useMemo } from "react";
import { useSimStore } from "../sim/simStore";
import { useEsdEventsCache, type EsdEventRow } from "./dataSource";

/** Count of phases whose start <= target. Linear over a tiny array. */
function countLE(starts: number[], target: number): number {
  let n = 0;
  for (const v of starts) if (v <= target) n++;
  return n;
}

/** Index of the phase whose [start, end] contains target, else -1. */
function findActive(
  starts: number[],
  ends: number[],
  target: number,
): number {
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= target && target <= ends[i]) return i;
  }
  return -1;
}

export interface ActiveEsdPhase {
  /**
   * Index of the phase whose [tStart, tEnd] window contains simTime,
   * or -1 when none does. -1 also covers the micro-gaps between
   * consecutive phases; gating banner visibility on this would make
   * the banner blink, which is why `inEsdRange` exists.
   */
  activePhaseIndex: number;

  /** Row at `activePhaseIndex`, or null on -1 / before events loaded. */
  activePhase: EsdEventRow | null;

  /**
   * True iff simTime is between the FIRST phase's tStart and the LAST
   * phase's tEnd (inclusive), even across the micro-gaps between
   * phases. This is what the banner gates on so it does not flicker.
   */
  inEsdRange: boolean;

  /**
   * Whole sim-minutes elapsed since the first phase's tStart, or -1
   * when `inEsdRange` is false. Quantized inside the selector so the
   * value steps at most once per sim-minute — never per rAF frame.
   */
  elapsedMinutes: number;

  /**
   * Number of phases with tStart <= simTime. Drives the "log that
   * grows" presentation in EventsTable.
   */
  visibleCount: number;
}

export function useActiveEsdPhase(): ActiveEsdPhase {
  const events = useEsdEventsCache();

  // Stable arrays for the selector closures. Reference changes exactly
  // once (null -> loaded) and stays stable afterwards, so each selector
  // closes over the same numbers for the lifetime of the page.
  const tStarts = useMemo(
    () => events?.map((e) => e.tStart) ?? [],
    [events],
  );
  const tEnds = useMemo(
    () => events?.map((e) => e.tEnd) ?? [],
    [events],
  );

  // Bounds of the whole ESD sequence. ±Infinity defaults make the
  // `inEsdRange` selector return false cleanly while events are still
  // loading (any finite simTime is outside [+∞, -∞]).
  const firstStart = tStarts.length > 0 ? tStarts[0] : Number.POSITIVE_INFINITY;
  const lastEnd =
    tEnds.length > 0 ? tEnds[tEnds.length - 1] : Number.NEGATIVE_INFINITY;

  // Primitive selectors: Zustand short-circuits subscriber updates on
  // strict equality, so each of these only triggers a re-render when
  // its specific value transitions — visibleCount on phase reveal,
  // activePhaseIndex on phase change, inEsdRange twice per ESD, and
  // elapsedMinutes once per sim-minute while in range.
  const visibleCount = useSimStore((s) => countLE(tStarts, s.simTime));
  const activePhaseIndex = useSimStore((s) =>
    findActive(tStarts, tEnds, s.simTime),
  );
  const inEsdRange = useSimStore(
    (s) => s.simTime >= firstStart && s.simTime <= lastEnd,
  );
  const elapsedMinutes = useSimStore((s) =>
    s.simTime >= firstStart && s.simTime <= lastEnd
      ? Math.floor((s.simTime - firstStart) / 60_000)
      : -1,
  );

  // Derived in component body — cheap, and avoids returning a fresh
  // object from a selector (which would defeat strict-equality cutoff).
  const activePhase =
    activePhaseIndex >= 0 && events ? events[activePhaseIndex] : null;

  return {
    activePhaseIndex,
    activePhase,
    inEsdRange,
    elapsedMinutes,
    visibleCount,
  };
}
