/**
 * Overview — control-room HMI site overview. A grid of well cards, one
 * per well, each tinted by its multi-state so the operator sees the
 * health of the whole site at a glance. Click a card to drill into the
 * Oil Well Detail for that well.
 *
 * Layered honesty (the reason we do NOT flip WELL_STATE_TO_PROCESS):
 *   - The card border / derrick color is `worstOf(wsState, oilState,
 *     gasState)` — the loudest signal. During an ESD, ft_oil ≈ 0 and
 *     ft_gas ≈ 0 fall below their per-well loloLimits, so evaluateState
 *     returns "alarm" via the existing limits and the card goes red.
 *   - The inner "PRODUCING / SHUTDOWN" label keeps its own color (the
 *     unmodified well_state mapping), so the operator can distinguish
 *     "stopped on purpose" from "tripped". A trip would surface as a
 *     separate alarm signal — not by overloading SHUTDOWN to red.
 *   - Each metric (oil, gas) is colored by its own state, so the card
 *     answers "why is it red" without an extra click.
 *
 * Re-render contract: each WellCard calls `useSeries(tag, well)` three
 * times. useSeries selects `currentIndex` (int) via simStore and
 * short-circuits on strict equality — the card re-renders only when
 * the underlying sample changes (~once per sim-minute), never per rAF
 * frame.
 *
 * No asset switch lives here on purpose (faithful to the manual): the
 * Overview shows the whole site, the Detail owns the well dropdown.
 */

import { useAssetStore } from "../state/assetStore";
import { useDisplayStore } from "../state/displayStore";
import { useSeries } from "../data/useSeries";
import { useScaleToFit } from "../hooks/useScaleToFit";
import { TAGS, getLimits, WELL_STATE_TO_PROCESS } from "../data/tagConfig";
import {
  STATE_GLYPH,
  evaluateState,
  type ProcessState,
} from "../theme/theme";
import { DerrickIcon } from "../symbols/DerrickIcon";
import "./Overview.css";

export function Overview() {
  const wells = useAssetStore((s) => s.wells);
  const navigateTo = useDisplayStore((s) => s.navigateTo);
  // Proportional shrink for narrow viewports. Same hook as Detail —
  // the WellCard grid keeps its native column count and column widths
  // and the whole shell scales down as one image.
  const { wrapperRef, shellRef } = useScaleToFit();
  return (
    <div className="hmi-scale-wrapper" ref={wrapperRef}>
      <div className="overview-shell" ref={shellRef}>
        <div className="overview-header">
          <span className="overview-header__site">Vaca Muerta</span>
          <span className="overview-header__sep">·</span>
          <span className="overview-header__name">Well Overview</span>
          {/* Drill-in to the pad collection. Sits at the right of the
              header (not over a card) so it reads as a display-level
              jump, not an action on any one well. Faithful hierarchy:
              site overview → pad detail → well detail. */}
          <button
            type="button"
            className="overview-header__nav-pad"
            onClick={() => navigateTo("well-pad-detail")}
            aria-label="Open Well Pad Detail"
          >
            Well Pad Detail →
          </button>
        </div>
        <div className="overview-grid">
          {wells.map((w) => (
            <WellCard key={w} well={w} />
          ))}
        </div>
      </div>
    </div>
  );
}

// "Worst" ordering for the card-level health combiner.
// alarm > warn > stale > normal. stale ranks above normal so a SHUTDOWN
// (mapped to stale) never gets hidden under a "normal" sibling state.
const STATE_RANK: Record<ProcessState, number> = {
  normal: 0,
  stale: 1,
  warn: 2,
  alarm: 3,
};

function worstOf(...states: ProcessState[]): ProcessState {
  let acc: ProcessState = "normal";
  for (const s of states) {
    if (STATE_RANK[s] > STATE_RANK[acc]) acc = s;
  }
  return acc;
}

function WellCard({ well }: { well: string }) {
  const setActiveWell = useAssetStore((s) => s.setActiveWell);
  const navigateTo = useDisplayStore((s) => s.navigateTo);

  // Four independent live readings for this well. Each useSeries call
  // is bound to `well` (not activeWell) so each card tracks its own
  // pump even though they all share simTime.
  //
  // corrosion_risk participates in the cardState color but is NOT shown
  // as a metric: the metric row stays focused on production rates
  // (oil + gas), which is what an operator scans for. The color is
  // sufficient signal that "something is off here"; drilling into the
  // detail surfaces the why. This also keeps the demo injection feature
  // honest — a slider in the Detail can light up the Overview without
  // having to widen the card layout for a single-purpose readout.
  const { currentValue: wellStateRaw } = useSeries("well_state", well);
  const { currentValue: oilRaw } = useSeries("ft_oil", well);
  const { currentValue: gasRaw } = useSeries("ft_gas", well);
  const { currentValue: corrosionRaw } = useSeries("corrosion_risk", well);

  const wellStateStr = typeof wellStateRaw === "string" ? wellStateRaw : "";
  const wsState: ProcessState =
    WELL_STATE_TO_PROCESS[wellStateStr] ?? "stale";

  const oil = typeof oilRaw === "number" ? oilRaw : null;
  const gas = typeof gasRaw === "number" ? gasRaw : null;
  const corrosion = typeof corrosionRaw === "number" ? corrosionRaw : null;
  const oilState = evaluateState(oil, getLimits("ft_oil", well));
  const gasState = evaluateState(gas, getLimits("ft_gas", well));
  const corrosionState = evaluateState(
    corrosion,
    getLimits("corrosion_risk", well),
  );

  const cardState = worstOf(wsState, oilState, gasState, corrosionState);

  const handleOpen = () => {
    setActiveWell(well);
    navigateTo("oil-well-detail");
  };

  return (
    <button
      type="button"
      className="well-card"
      data-state={cardState}
      onClick={handleOpen}
      aria-label={`Open ${well} detail`}
    >
      <div className="well-card__top">
        <DerrickIcon className="well-card__derrick" />
        <div className="well-card__id">{well}</div>
      </div>

      <div className="well-card__state" data-state={wsState}>
        {STATE_GLYPH[wsState] && (
          <span className="well-card__state-glyph" aria-hidden>
            {STATE_GLYPH[wsState]}
          </span>
        )}
        <span className="well-card__state-label">
          {wellStateStr || "—"}
        </span>
      </div>

      <div className="well-card__metrics">
        <Metric
          label={TAGS.ft_oil.label}
          value={oil}
          unit={TAGS.ft_oil.unit}
          decimals={TAGS.ft_oil.decimals}
          state={oilState}
        />
        <Metric
          label={TAGS.ft_gas.label}
          value={gas}
          unit={TAGS.ft_gas.unit}
          decimals={TAGS.ft_gas.decimals}
          state={gasState}
        />
      </div>
    </button>
  );
}

function Metric({
  label,
  value,
  unit,
  decimals,
  state,
}: {
  label: string;
  value: number | null;
  unit: string;
  decimals: number;
  state: ProcessState;
}) {
  const display = value == null ? "—" : value.toFixed(decimals);
  return (
    <div className="well-card__metric" data-state={state}>
      <span className="well-card__metric-label">{label}</span>
      <span className="well-card__metric-value">{display}</span>
      <span className="well-card__metric-unit">{unit}</span>
    </div>
  );
}
