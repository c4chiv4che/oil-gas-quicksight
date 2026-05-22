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
 * Default lands on "oil-well-detail" because that is the only fully
 * rendering display today; once Overview is built, the default moves
 * there.
 */

export type DisplayId = "overview" | "oil-well-detail";

export interface DisplayState {
  activeDisplay: DisplayId;
  navigateTo: (id: DisplayId) => void;
}

export const useDisplayStore = create<DisplayState>((set) => ({
  activeDisplay: "oil-well-detail",
  navigateTo: (id) => set({ activeDisplay: id }),
}));
