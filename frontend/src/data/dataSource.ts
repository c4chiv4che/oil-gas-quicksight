/**
 * dataSource.ts — single point of access to the pre-generated demo
 * datasets (Athena-shaped JSON). Today the files are served as static
 * assets from /data/demo/*; tomorrow VITE_DATA_BASE can point at S3 or
 * a signed CDN and nothing else changes.
 *
 * IMPORTANT — load policy:
 *   loadWells() is called ONCE by App.tsx (DataBoot). Symbols MUST NOT
 *   call it directly; they subscribe to the cache via useWellsCache().
 *   The promise-level cache makes accidental concurrent calls safe, but
 *   keeping the contract explicit avoids surprises later (e.g. lazy
 *   re-fetch on every symbol mount).
 */

import { useSyncExternalStore } from "react";

/**
 * Base URL for static datasets. Derived from Vite's BASE_URL so it
 * automatically follows the deployment subpath: '/data/demo' in dev,
 * '/oil-gas-quicksight/data/demo' on GitHub Pages. An explicit
 * VITE_DATA_BASE override stays available for a future S3/CDN swap
 * without touching the build's `base`.
 */
export const DATA_BASE =
  import.meta.env.VITE_DATA_BASE ??
  `${import.meta.env.BASE_URL}data/demo`.replace(/\/\/+/g, "/");

/**
 * Row schema mirrors the Athena columns (snake_case). Field `t` is
 * derived at load time — it is NOT part of the Athena schema, only a
 * pre-parsed numeric copy of `timestamp` so binary search at 60fps
 * does not re-parse strings.
 */
export interface WellRow {
  /** Epoch ms parsed from `timestamp`. Added at load — not in Athena. */
  t: number;
  timestamp: string;
  well_id: string;
  well_state: "PRODUCING" | "SHUTDOWN";
  shutdown_reason: string;
  whp: number;
  chp: number;
  tt_flow: number;
  ft_oil: number;
  ft_gas: number;
  ft_water: number;
  pt_downhole: number;
  corrosion_risk: number;
  hydrate_risk: number;
}

/**
 * Parses an Athena-style timestamp ("YYYY-MM-DD HH:MM:SS.sss") as UTC.
 * Date.parse on the raw string is locale/TZ-dependent across browsers;
 * forcing the "T" separator and a trailing "Z" makes it unambiguous.
 */
function parseAthenaTs(s: string): number {
  return Date.parse(s.replace(" ", "T") + "Z");
}

// ---- Wells cache ----------------------------------------------------------

let wellsCache: WellRow[] | null = null;
let wellsPromise: Promise<WellRow[]> | null = null;
const wellsListeners = new Set<() => void>();

function notifyWells(): void {
  for (const fn of wellsListeners) fn();
}

function subscribeWells(fn: () => void): () => void {
  wellsListeners.add(fn);
  return () => {
    wellsListeners.delete(fn);
  };
}

function getWellsCache(): WellRow[] | null {
  return wellsCache;
}

/**
 * Loads wells_esd.json once and caches it. Idempotent: re-entrant
 * callers get the same in-flight promise; later callers get the
 * resolved cache. App.tsx owns the single legitimate call site.
 */
export function loadWells(): Promise<WellRow[]> {
  if (wellsCache) return Promise.resolve(wellsCache);
  if (wellsPromise) return wellsPromise;
  wellsPromise = fetch(`${DATA_BASE}/wells_esd.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`wells_esd.json: HTTP ${r.status}`);
      return r.json() as Promise<Omit<WellRow, "t">[]>;
    })
    .then((rows) => {
      const out: WellRow[] = rows.map((r) => ({
        ...r,
        t: parseAthenaTs(r.timestamp),
      }));
      // Defensive sort: rows must be ascending per well so binary search
      // is correct. The exporter already orders by (well_id, timestamp)
      // but we cannot trust that across formats.
      out.sort((a, b) =>
        a.well_id === b.well_id
          ? a.t - b.t
          : a.well_id < b.well_id
            ? -1
            : 1,
      );
      wellsCache = out;
      notifyWells();
      return out;
    });
  return wellsPromise;
}

/**
 * Subscribes to the wells cache. Returns null until DataBoot completes,
 * then the populated array. Re-renders exactly once on the null→array
 * transition (the array reference never changes afterwards).
 */
export function useWellsCache(): WellRow[] | null {
  return useSyncExternalStore(subscribeWells, getWellsCache, () => null);
}

// ---- ESD events cache -----------------------------------------------------

/**
 * One row in esd_events.json — a single ESD phase. tStart/tEnd are
 * pre-parsed epoch ms; the original string columns are kept for
 * traceability against Athena. The flare/hotoil aggregates are kept on
 * the row for a future per-phase detail panel; EventsTable does not
 * render them (the log stays at Phase | Start | Duration | Reason).
 */
export interface EsdEventRow {
  /** Epoch ms parsed from `phase_start`. Added at load — not in Athena. */
  tStart: number;
  /** Epoch ms parsed from `phase_end`. */
  tEnd: number;
  esd_phase: string;
  esd_reason: string;
  minutes_in_phase: number;
  phase_start: string;
  phase_end: string;
  peak_flare_hp_mm3d: number;
  avg_flare_hp_mm3d: number;
  min_hotoil_supply_c: number;
  max_hotoil_supply_c: number;
}

let esdEventsCache: EsdEventRow[] | null = null;
let esdEventsPromise: Promise<EsdEventRow[]> | null = null;
const esdEventsListeners = new Set<() => void>();

function notifyEsdEvents(): void {
  for (const fn of esdEventsListeners) fn();
}

function subscribeEsdEvents(fn: () => void): () => void {
  esdEventsListeners.add(fn);
  return () => {
    esdEventsListeners.delete(fn);
  };
}

function getEsdEventsCache(): EsdEventRow[] | null {
  return esdEventsCache;
}

/**
 * Loads esd_events.json once and caches it. Mirrors loadWells:
 * idempotent, promise-level dedupe, single legitimate call site in
 * App.tsx's DataBoot. The file is tiny (6 rows) so we trade nothing by
 * eager-loading it next to wells.
 */
export function loadEsdEvents(): Promise<EsdEventRow[]> {
  if (esdEventsCache) return Promise.resolve(esdEventsCache);
  if (esdEventsPromise) return esdEventsPromise;
  esdEventsPromise = fetch(`${DATA_BASE}/esd_events.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`esd_events.json: HTTP ${r.status}`);
      return r.json() as Promise<Omit<EsdEventRow, "tStart" | "tEnd">[]>;
    })
    .then((rows) => {
      const out: EsdEventRow[] = rows.map((r) => ({
        ...r,
        tStart: parseAthenaTs(r.phase_start),
        tEnd: parseAthenaTs(r.phase_end),
      }));
      // Defensive sort by phase start. The exporter already orders
      // chronologically but we cannot trust that across formats.
      out.sort((a, b) => a.tStart - b.tStart);
      esdEventsCache = out;
      notifyEsdEvents();
      return out;
    });
  return esdEventsPromise;
}

/**
 * Subscribes to the ESD events cache. Same null→array, never-mutates
 * contract as useWellsCache: components see null until DataBoot resolves
 * the fetch, then receive the populated array exactly once.
 */
export function useEsdEventsCache(): EsdEventRow[] | null {
  return useSyncExternalStore(
    subscribeEsdEvents,
    getEsdEventsCache,
    () => null,
  );
}
