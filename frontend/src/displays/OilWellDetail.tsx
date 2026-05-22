/**
 * OilWellDetail — first real HMI display, composed from existing symbols.
 *
 * Layout responsibilities ONLY: no new data logic, no symbol rewrites.
 * The symbols (ValueSymbol, GaugeSymbol, TrendSymbol, EventsTable) are
 * consumed as-is; this file just places them in a CSS Grid hierarchy
 * with proper visual ranking (summary at top, detail below).
 *
 * The display is self-contained: it reads activeWell from assetStore
 * and builds its own trend config so App.tsx stays display-agnostic.
 * Future displays (Overview, Well Pad Detail) will live alongside this
 * one in displays/ and follow the same shape — App will eventually
 * pick one to render, but routing is deliberately deferred until a
 * second display actually exists.
 */

import { useMemo } from "react";
import { useAssetStore } from "../state/assetStore";
import { useSimStore } from "../sim/simStore";
import { useSeries } from "../data/useSeries";
import { WELL_STATE_TO_PROCESS } from "../data/tagConfig";
import { STATE_GLYPH, type ProcessState } from "../theme/theme";
import { ValueSymbol } from "../symbols/ValueSymbol";
import { GaugeSymbol } from "../symbols/GaugeSymbol";
import { TrendSymbol } from "../symbols/TrendSymbol";
import { EventsTable } from "../symbols/EventsTable";
import type { TrendConfig } from "../symbols/trendConfig";
import "./OilWellDetail.css";

export function OilWellDetail() {
  const activeWell = useAssetStore((s) => s.activeWell);
  const windowStart = useSimStore((s) => s.windowStart);
  const windowEnd = useSimStore((s) => s.windowEnd);

  // Display owns its own trend spec. Memoized so TrendSymbol's mount
  // effect deps stay stable across unrelated re-renders.
  const trendConfig = useMemo<TrendConfig | null>(() => {
    if (!windowStart || !windowEnd) return null;
    return {
      id: "oil-well-detail-rates",
      title: "Production rates",
      from: windowStart,
      to: windowEnd,
      series: [
        { tag: "ft_oil", axis: "left" },
        { tag: "ft_gas", axis: "right" },
      ],
      showLimits: true,
    };
  }, [windowStart, windowEnd]);

  return (
    <div className="display-shell">
      <DisplayHeader well={activeWell} />

      <div className="display-values">
        <ValueSymbol tag="whp" />
        <ValueSymbol tag="chp" />
        <ValueSymbol tag="tt_flow" />
        <ValueSymbol tag="well_state" />
      </div>

      <div className="display-gauges">
        <GaugeSymbol tag="whp" />
        <GaugeSymbol tag="pt_downhole" />
      </div>

      <div className="display-trend">
        {trendConfig && <TrendSymbol config={trendConfig} />}
      </div>

      <div className="display-events">
        <EventsTable />
      </div>
    </div>
  );
}

/**
 * Display header: well id on the left, well-state badge on the right.
 *
 * The badge reuses the public WELL_STATE_TO_PROCESS map (same source
 * ValueSymbol consumes) so the dot color and state label cannot drift
 * from the rest of the display. No reimplementation of evaluateState.
 */
function DisplayHeader({ well }: { well: string }) {
  return (
    <div className="display-header">
      <div className="display-header__title">
        <span className="display-header__well">{well}</span>
        <span className="display-header__name">· Oil Well Detail</span>
      </div>
      <WellStateBadge well={well} />
    </div>
  );
}

function WellStateBadge({ well }: { well: string }) {
  const { currentValue } = useSeries("well_state", well);
  const str = typeof currentValue === "string" ? currentValue : "";
  const state: ProcessState = WELL_STATE_TO_PROCESS[str] ?? "stale";
  const color = `var(--state-${state})`;
  const glyph = STATE_GLYPH[state];

  return (
    <div className="display-header__state">
      <span className="display-header__state-label">State</span>
      <span
        className="display-header__state-dot"
        style={{ background: color }}
        aria-hidden
      />
      <span className="display-header__state-value" style={{ color }}>
        {glyph && <span style={{ marginRight: 4 }}>{glyph}</span>}
        {str || "—"}
      </span>
    </div>
  );
}
