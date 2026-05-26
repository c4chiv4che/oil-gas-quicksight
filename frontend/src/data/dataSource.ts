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

// ---- Utilities (ESD-day, per-minute) cache --------------------------------

/**
 * One per-minute row of utilities_esd.json — the recorded ESD day for the
 * utilities layer (1440 rows). `t` is pre-parsed epoch ms; the rest mirror
 * the Athena columns. Feeds the Analytics display only; loaded lazily there,
 * not in DataBoot, so the ~324 KB is paid only when Analytics is opened.
 */
export interface UtilitiesEsdRow {
  /** Epoch ms parsed from `timestamp`. Added at load — not in Athena. */
  t: number;
  timestamp: string;
  esd_phase: string;
  esd_reason: string;
  ft_flare_hp: number;
  tt_hotoil_supply: number;
  tt_hotoil_return: number;
  qi_flare_smoke: number;
}

let utilitiesEsdCache: UtilitiesEsdRow[] | null = null;
let utilitiesEsdPromise: Promise<UtilitiesEsdRow[]> | null = null;
const utilitiesEsdListeners = new Set<() => void>();

function notifyUtilitiesEsd(): void {
  for (const fn of utilitiesEsdListeners) fn();
}

function subscribeUtilitiesEsd(fn: () => void): () => void {
  utilitiesEsdListeners.add(fn);
  return () => {
    utilitiesEsdListeners.delete(fn);
  };
}

function getUtilitiesEsdCache(): UtilitiesEsdRow[] | null {
  return utilitiesEsdCache;
}

/**
 * Loads utilities_esd.json once and caches it. Idempotent, promise-level
 * dedupe — same contract as loadWells/loadEsdEvents. Unlike those, the
 * single legitimate call site is AnalyticsDisplay's mount effect (lazy),
 * since this dataset only feeds the Analytics display.
 */
export function loadUtilitiesEsd(): Promise<UtilitiesEsdRow[]> {
  if (utilitiesEsdCache) return Promise.resolve(utilitiesEsdCache);
  if (utilitiesEsdPromise) return utilitiesEsdPromise;
  utilitiesEsdPromise = fetch(`${DATA_BASE}/utilities_esd.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`utilities_esd.json: HTTP ${r.status}`);
      return r.json() as Promise<Omit<UtilitiesEsdRow, "t">[]>;
    })
    .then((rows) => {
      const out: UtilitiesEsdRow[] = rows.map((r) => ({
        ...r,
        t: parseAthenaTs(r.timestamp),
      }));
      // Defensive sort by time: the chart's x scale and any bsearch assume
      // ascending samples. The exporter already orders by timestamp.
      out.sort((a, b) => a.t - b.t);
      utilitiesEsdCache = out;
      notifyUtilitiesEsd();
      return out;
    });
  return utilitiesEsdPromise;
}

/** Subscribes to the utilities ESD-day cache (null→array, never mutates). */
export function useUtilitiesEsdCache(): UtilitiesEsdRow[] | null {
  return useSyncExternalStore(
    subscribeUtilitiesEsd,
    getUtilitiesEsdCache,
    () => null,
  );
}

// ---- Plant (ESD-day, per-minute) cache ------------------------------------

/**
 * One per-minute row of plant_esd.json — the recorded ESD day for the plant
 * layer (1440 rows), carrying fiscal gas-quality analyzers. `t` is pre-parsed
 * epoch ms. Feeds the Analytics display only; lazy-loaded there (~232 KB).
 */
export interface PlantEsdRow {
  /** Epoch ms parsed from `timestamp`. Added at load — not in Athena. */
  t: number;
  timestamp: string;
  plant_event: string;
  esd_phase: string;
  ai_wobbe: number;
  ai_pcs: number;
}

let plantEsdCache: PlantEsdRow[] | null = null;
let plantEsdPromise: Promise<PlantEsdRow[]> | null = null;
const plantEsdListeners = new Set<() => void>();

function notifyPlantEsd(): void {
  for (const fn of plantEsdListeners) fn();
}

function subscribePlantEsd(fn: () => void): () => void {
  plantEsdListeners.add(fn);
  return () => {
    plantEsdListeners.delete(fn);
  };
}

function getPlantEsdCache(): PlantEsdRow[] | null {
  return plantEsdCache;
}

/**
 * Loads plant_esd.json once and caches it. Idempotent, promise-level dedupe.
 * Single legitimate call site: AnalyticsDisplay's mount effect (lazy).
 */
export function loadPlantEsd(): Promise<PlantEsdRow[]> {
  if (plantEsdCache) return Promise.resolve(plantEsdCache);
  if (plantEsdPromise) return plantEsdPromise;
  plantEsdPromise = fetch(`${DATA_BASE}/plant_esd.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`plant_esd.json: HTTP ${r.status}`);
      return r.json() as Promise<Omit<PlantEsdRow, "t">[]>;
    })
    .then((rows) => {
      const out: PlantEsdRow[] = rows.map((r) => ({
        ...r,
        t: parseAthenaTs(r.timestamp),
      }));
      out.sort((a, b) => a.t - b.t);
      plantEsdCache = out;
      notifyPlantEsd();
      return out;
    });
  return plantEsdPromise;
}

/** Subscribes to the plant ESD-day cache (null→array, never mutates). */
export function usePlantEsdCache(): PlantEsdRow[] | null {
  return useSyncExternalStore(
    subscribePlantEsd,
    getPlantEsdCache,
    () => null,
  );
}
