import { create } from "zustand";

/**
 * Display navigation store — "which display am I looking at?".
 *
 * Deliberately tiny: no URL sync, no history stack, no react-router.
 * One Zustand value + one setter, consumed by a `DisplayRouter` switch
 * at the root. When a future display arrives, we add a string literal
 * to `DisplayId`, a case in the router, and call `navigateTo` from
 * wherever the entry point lives. No further plumbing.
 *
 * Kept separate from assetStore so the two concerns ("which display"
 * vs "which well") subscribe independently — components that follow
 * one do not re-render on the other.
 *
 * Default lands on "overview": it is the natural entry point of the
 * HMI — see the whole site at a glance, then drill into a well. The
 * "← Overview" button in the Oil Well Detail header returns here.
 */

export type DisplayId =
  | "overview"
  | "oil-well-detail"
  | "well-pad-detail"
  | "analytics";

export interface DisplayState {
  activeDisplay: DisplayId;
  navigateTo: (id: DisplayId) => void;
}

export const useDisplayStore = create<DisplayState>((set) => ({
  activeDisplay: "overview",
  navigateTo: (id) => set({ activeDisplay: id }),
}));
