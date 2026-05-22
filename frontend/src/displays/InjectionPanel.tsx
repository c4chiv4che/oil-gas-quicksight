/**
 * InjectionPanel — DEMO control that manually overrides corrosion_risk
 * for the active well, so the multi-state cascade can be triggered on
 * datasets where the risk would otherwise stay in the green zone.
 *
 * Why a panel rather than a button: this is meta tooling, not part of
 * the operational HMI. In a real plant an operator cannot fabricate
 * process values — doing so silently could mask real conditions. The
 * panel is heavily styled to read as "tool / chrome" (dashed border,
 * "⚙ DEMO" badge, "not a real control" hint), distinct from the solid
 * surface panels of the live HMI.
 *
 * How the cascade works WITHOUT touching any symbol:
 *   slider onChange -> setOverride(key, v)
 *      -> injectionStore mutates
 *      -> useSeries(corrosion_risk, activeWell) selector returns v
 *      -> ValueSymbol & GaugeSymbol re-render
 *      -> evaluateState(v, limits) classifies normal/warn/alarm
 *      -> text color, glyph, gauge needle, gauge readout all update
 *   All of that is downstream of useSeries; this panel knows nothing
 *   about the symbols and the symbols know nothing about injection.
 *
 * Scope: persists per (tag, well). Switching activeWell re-binds the
 * slider to the new well, but existing overrides on the previous well
 * stay live (their cascade keeps showing on Overview etc.). All active
 * overrides surface as chips below so nothing is hidden.
 */

import { type ChangeEvent } from "react";
import { useAssetStore } from "../state/assetStore";
import { useSeries } from "../data/useSeries";
import { useInjectionStore, injectionKey } from "../state/injectionStore";
import "./InjectionPanel.css";

const TAG = "corrosion_risk" as const;
const MIN = 0;
const MAX = 1;
const STEP = 0.01;

export function InjectionPanel() {
  const activeWell = useAssetStore((s) => s.activeWell);
  const key = injectionKey(activeWell, TAG);

  // useSeries returns the override if set, otherwise the recorded
  // value. The slider mirrors whatever the rest of the HMI currently
  // shows — so clearing the override makes the slider snap back to
  // the live reading naturally (no extra wiring needed).
  const { currentValue } = useSeries(TAG, activeWell);
  const sliderValue = typeof currentValue === "number" ? currentValue : 0;

  const overrides = useInjectionStore((s) => s.overrides);
  const setOverride = useInjectionStore((s) => s.setOverride);
  const clearAll = useInjectionStore((s) => s.clearAll);

  const onSlide = (e: ChangeEvent<HTMLInputElement>) => {
    setOverride(key, Number(e.target.value));
  };
  const onReset = () => setOverride(key, null);

  const isInjecting = key in overrides;
  const activeKeys = Object.keys(overrides).sort();

  return (
    <div
      className="injection-panel"
      role="region"
      aria-label="Demo: risk injection"
    >
      <div className="injection-panel__head">
        <span className="injection-panel__badge">⚙ DEMO</span>
        <span className="injection-panel__title">RISK INJECTION</span>
        <span className="injection-panel__hint">
          not a real control · manual override for demo only
        </span>
      </div>

      <div className="injection-panel__row">
        <label className="injection-panel__label" htmlFor="injection-slider">
          {TAG}{" "}
          <span className="injection-panel__well">· {activeWell}</span>
        </label>
        <input
          id="injection-slider"
          type="range"
          min={MIN}
          max={MAX}
          step={STEP}
          value={sliderValue}
          onChange={onSlide}
          className="injection-panel__slider"
        />
        <span className="injection-panel__value">{sliderValue.toFixed(2)}</span>
        <button
          type="button"
          className="injection-panel__btn"
          onClick={onReset}
          disabled={!isInjecting}
        >
          Reset
        </button>
      </div>

      {activeKeys.length > 0 && (
        <div className="injection-panel__active">
          <span className="injection-panel__active-k">Active overrides:</span>
          {activeKeys.map((k) => (
            <span key={k} className="injection-panel__chip">
              {k} = {overrides[k].toFixed(2)}
            </span>
          ))}
          <button
            type="button"
            className="injection-panel__btn injection-panel__btn--secondary"
            onClick={clearAll}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
