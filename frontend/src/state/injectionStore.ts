/**
 * injectionStore — DEMO-ONLY manual value overrides for live tags.
 *
 * Keyed by `${well}::${tag}`. When an entry exists, useSeries
 * substitutes the override for `currentValue` so every symbol of that
 * tag re-evaluates state through the same pure pipeline
 * (evaluateState + tag limits) and visually cascades — without the
 * symbol code knowing anything about injection.
 *
 * RE-RENDER CONTRACT
 *   Every useSeries call subscribes here. To keep the no-injection case
 *   free, EVERY action is strict-equality-idempotent:
 *     - setOverride(key, v) returns the same state ref if overrides[key]
 *       is already v (or if v is null and key is absent).
 *     - clearAll() returns the same state ref if the map is already empty.
 *   That means Zustand's subscriber short-circuit fires for every
 *   no-op, including the common case "store mutated for some OTHER
 *   key, this subscriber's selector still returns null" — selector
 *   returns null === null, no re-render.
 *
 * SCOPE
 *   Overrides are per (tag, well). They PERSIST across activeWell
 *   changes so an operator can dial a value on one well, navigate
 *   away, and the cascade survives. The InjectionPanel surfaces all
 *   active overrides as chips so nothing is hidden.
 *
 * SAFETY DISCLAIMER
 *   This is a demo control. In a real HMI an operator cannot fabricate
 *   process values — the InjectionPanel is heavily styled as meta
 *   ("⚙ DEMO · not a real control") to make that distinction obvious.
 */

import { create } from "zustand";

export const injectionKey = (well: string, tag: string): string =>
  `${well}::${tag}`;

export interface InjectionState {
  overrides: Record<string, number>;
  /** Set `value` for `key`, or remove the entry when `value` is null. */
  setOverride: (key: string, value: number | null) => void;
  /** Remove every override. */
  clearAll: () => void;
}

export const useInjectionStore = create<InjectionState>((set) => ({
  overrides: {},
  setOverride: (key, value) =>
    set((s) => {
      if (value === null) {
        if (!(key in s.overrides)) return s;
        const next = { ...s.overrides };
        delete next[key];
        return { overrides: next };
      }
      if (s.overrides[key] === value) return s;
      return { overrides: { ...s.overrides, [key]: value } };
    }),
  clearAll: () =>
    set((s) =>
      Object.keys(s.overrides).length === 0 ? s : { overrides: {} },
    ),
}));
