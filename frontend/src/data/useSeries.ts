/**
 * useSeries — the single hook every symbol uses to read a tag.
 *
 * Inputs:  a tag name (column on WellRow) and optionally a well id
 *          (defaults to assetStore.activeWell).
 * Outputs: the full series + aligned timestamp array (for trends/bars
 *          tomorrow) AND the current value at simTime (for value
 *          symbols today). One hook, future-proof.
 *
 * Performance contract (this is the whole reason the hook exists):
 *
 *   The Zustand SELECTOR returns `currentIndex`, a derived number.
 *   Zustand short-circuits subscriber updates with strict equality on
 *   the selector output, so the component re-renders ONLY when the
 *   index actually changes — i.e. when simTime crosses to the next
 *   sample (~once per simulated minute). The store still updates at
 *   ~60Hz, but the React tree does not.
 *
 *   The selector cost is O(log N) per store update per subscribed
 *   symbol (N ≈ 1440 = log2 ≈ 11 ops). At ~10 symbols × 60Hz ≈ 6.6k
 *   ops/sec, this is negligible compared to anything else on screen.
 *
 *   We deliberately do NOT share currentIndex between symbols of the
 *   same well via a context yet. Premature; revisit if profiling
 *   shows contention.
 */

import { useMemo } from "react";
import { useSimStore } from "../sim/simStore";
import { useAssetStore } from "../state/assetStore";
import { useWellsCache, type WellRow } from "./dataSource";

export interface SeriesView<V = number> {
  /** Full column of values for the tag, length N. */
  series: V[];
  /** Epoch ms timestamps aligned with `series`, length N. */
  t: number[];
  /** Largest i with t[i] <= simTime; -1 if before window or no data. */
  currentIndex: number;
  currentValue: V | null;
  currentRow: WellRow | null;
}

/**
 * Per-well derived view: rows filtered to one well, the aligned t
 * array, and lazily-built column caches. Module-level cache keyed by
 * well_id; built once, reused forever (the underlying data never
 * mutates after load).
 */
interface WellView {
  rows: WellRow[];
  t: number[];
  columns: Map<string, unknown[]>;
}
const wellViews = new Map<string, WellView>();

function buildWellView(wellId: string, all: WellRow[]): WellView {
  const rows = all.filter((r) => r.well_id === wellId);
  const t = rows.map((r) => r.t);
  return { rows, t, columns: new Map() };
}

function getColumn<K extends keyof WellRow>(
  view: WellView,
  tag: K,
): WellRow[K][] {
  const cached = view.columns.get(tag as string);
  if (cached) return cached as WellRow[K][];
  const col = view.rows.map((r) => r[tag]);
  view.columns.set(tag as string, col as unknown[]);
  return col;
}

/**
 * Binary search: returns the largest i such that t[i] <= target.
 * Returns -1 if target < t[0] or the array is empty.
 *
 * Inclusive-LE semantics: at exactly t[i], we are showing sample i.
 * This matches "value held until next sample" — the right reading for
 * minute-resolution process data.
 */
function bsearchLE(t: number[], target: number): number {
  const n = t.length;
  if (n === 0 || target < t[0]) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (t[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function useSeries<K extends keyof WellRow>(
  tag: K,
  well?: string,
): SeriesView<WellRow[K]> {
  const wells = useWellsCache();
  const activeWell = useAssetStore((s) => s.activeWell);
  const wellId = well ?? activeWell;

  // Build (or reuse) the per-well view. Cheap on cache hit; the
  // useMemo dep guards against rebuilding when wells/wellId are stable.
  const view = useMemo<WellView | null>(() => {
    if (!wells) return null;
    const cached = wellViews.get(wellId);
    if (cached) return cached;
    const fresh = buildWellView(wellId, wells);
    wellViews.set(wellId, fresh);
    return fresh;
  }, [wells, wellId]);

  // Selector closes over `view`. When view is null the selector always
  // returns -1, so no re-renders fire from simTime ticks. Once view is
  // populated, re-renders fire exactly when the index changes.
  const currentIndex = useSimStore((s) =>
    view ? bsearchLE(view.t, s.simTime) : -1,
  );

  if (!view) {
    return {
      series: [],
      t: [],
      currentIndex: -1,
      currentValue: null,
      currentRow: null,
    };
  }

  const series = getColumn(view, tag);
  const currentValue =
    currentIndex >= 0 ? (series[currentIndex] as WellRow[K]) : null;
  const currentRow = currentIndex >= 0 ? view.rows[currentIndex] : null;

  return {
    series,
    t: view.t,
    currentIndex,
    currentValue,
    currentRow,
  };
}
