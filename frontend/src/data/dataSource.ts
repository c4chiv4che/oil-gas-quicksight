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

/** Base URL for static datasets. Swappable via env (S3, CDN, mock). */
export const DATA_BASE = import.meta.env.VITE_DATA_BASE ?? "/data/demo";

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
