import { create } from "zustand";

/**
 * Asset context store — "which well are we looking at?".
 *
 * Kept SEPARATE from the time engine (simStore) on purpose: symbols
 * that care about asset switching subscribe here, symbols that care
 * about the clock subscribe to simStore. Mixing them would force
 * re-renders on every frame for components that only need to know
 * the active well, and vice-versa.
 *
 * Phase-2 asset tree / well selector dropdown plugs into this same
 * store without touching symbols.
 */

export interface AssetState {
  /** Currently selected well id (e.g. "LLL-001"). */
  activeWell: string;
  /** Discovered well ids from the loaded dataset. Empty until DataBoot. */
  wells: string[];
  setActiveWell: (id: string) => void;
  setWellList: (ids: string[]) => void;
}

export const useAssetStore = create<AssetState>((set) => ({
  activeWell: "LLL-001",
  wells: [],
  setActiveWell: (id) => set({ activeWell: id }),
  setWellList: (ids) => set({ wells: ids }),
}));
