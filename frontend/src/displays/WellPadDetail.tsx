/**
 * WellPadDetail — third HMI display: a well-pad drill-in, modeled on the
 * collection pattern of industry-standard control-room HMI tools.
 *
 * The pad's wells are shown as a COLLECTION: one identical well template
 * (WellColumn) replicated for every well, laid out as a horizontal row so
 * the operator compares the pad's wells side by side. In a control-room
 * HMI this is a repeated symbol template; in React it is a component that
 * maps over the well list and renders a template per well — each template
 * pulls its own live readings via useSeries, exactly like the Overview's
 * WellCard does per card.
 *
 * Two values are derived because the simulator genuinely lacks them, and
 * BOTH are spelled out in the on-screen disclaimer rather than invented:
 *   - Pad name is derived from the shared well-id prefix (no pad column
 *     exists in the dataset).
 *   - "Downtime (24h)" is REAL SHUTDOWN minutes counted over the single
 *     day this dataset spans — not a long-run average.
 *
 * Navigation: clicking a well drills into its Oil Well Detail
 * (setActiveWell + navigateTo), same as the WellCard. The entry point INTO
 * this display is a button in the Overview header, giving the hierarchy
 * site overview → pad detail → well detail.
 */

import { useMemo } from "react";
import { useAssetStore } from "../state/assetStore";
import { useDisplayStore } from "../state/displayStore";
import { useSeries } from "../data/useSeries";
import { useScaleToFit } from "../hooks/useScaleToFit";
import { TAGS, getLimits, WELL_STATE_TO_PROCESS } from "../data/tagConfig";
import { STATE_GLYPH, evaluateState, type ProcessState } from "../theme/theme";
import { DerrickIcon } from "../symbols/DerrickIcon";
import { formatMinutes } from "../utils/format";
import "./WellPadDetail.css";

/** Production area for this pad. Constant, matching the Overview's site
 *  label so the two displays agree — there is no basin/area column in the
 *  dataset (see the disclaimer). */
const PRODUCTION_AREA = "Vaca Muerta";

/**
 * Derives the pad name from the wells' shared id prefix: "LLL-001" →
 * "LLL Pad". There is no pad column in the dataset, so this is an
 * inferred label, not data — documented in the disclaimer. Falls back to
 * "LLL Pad" before the well list has loaded.
 */
function derivePadName(wells: string[]): string {
  const prefix = wells[0]?.split("-")[0];
  return prefix ? `${prefix} Pad` : "LLL Pad";
}

export function WellPadDetail() {
  const wells = useAssetStore((s) => s.wells);
  const navigateTo = useDisplayStore((s) => s.navigateTo);
  // Same proportional-shrink hook as the other two displays: the shell is
  // authored at 1366px and scales down as one image on narrow viewports.
  const { wrapperRef, shellRef } = useScaleToFit();

  const padName = derivePadName(wells);

  return (
    <div className="hmi-scale-wrapper" ref={wrapperRef}>
      <div className="pad-shell" ref={shellRef}>
        <div className="pad-header">
          {/* Discreet "up one level" breadcrumb, same wiring as the Oil
              Well Detail's back button. No URL, no history. */}
          <button
            type="button"
            className="pad-header__nav-back"
            onClick={() => navigateTo("overview")}
            aria-label="Back to Overview"
          >
            ← Overview
          </button>
          {/* Two large value symbols side by side: pad name + production
              area. No label / unit / timestamp — title style. */}
          <div className="pad-header__titles">
            <span className="pad-header__pad">{padName}</span>
            <span className="pad-header__sep" aria-hidden>
              ·
            </span>
            <span className="pad-header__area">{PRODUCTION_AREA}</span>
          </div>
        </div>

        <WellCollection wells={wells} />

        <p className="pad-disclaimer">
          <strong>Derived values.</strong> Two values are derived rather than
          read directly from the dataset, for transparency: the{" "}
          <strong>pad name</strong> (<em>{padName}</em>) is inferred from the
          wells' shared id prefix — the dataset has no pad column; and{" "}
          <strong>Downtime (24h)</strong> is real time spent in SHUTDOWN over
          the recorded day, counted from the recorded well state, not a
          long-run average.
        </p>
      </div>
    </div>
  );
}

/**
 * WellCollection — the collection itself: map over the pad's wells and
 * render one WellColumn template each, in a horizontal row. The column
 * count tracks the actual well list (4 today) rather than
 * being hard-coded, so the row stays correct if the dataset's well set
 * changes.
 */
function WellCollection({ wells }: { wells: string[] }) {
  return (
    <div
      className="pad-collection"
      style={{ gridTemplateColumns: `repeat(${Math.max(wells.length, 1)}, 1fr)` }}
    >
      {wells.map((w) => (
        <WellColumn key={w} well={w} />
      ))}
    </div>
  );
}

/**
 * WellColumn — the replicated well template. Pulls its own live readings
 * (same per-well useSeries pattern as the Overview's WellCard) so each
 * column tracks its own well while all share simTime.
 *
 * Top-to-bottom: derrick → well name → state → Downtime (24h) → Oil Rate.
 */
function WellColumn({ well }: { well: string }) {
  const setActiveWell = useAssetStore((s) => s.setActiveWell);
  const navigateTo = useDisplayStore((s) => s.navigateTo);

  // One call yields BOTH the current state (badge) and the full recorded
  // column (downtime). The series reference is stable (module-cached in
  // useSeries), so the downtime useMemo runs once.
  const { currentValue: wellStateRaw, series: wellStateSeries } = useSeries(
    "well_state",
    well,
  );
  const { currentValue: oilRaw } = useSeries("ft_oil", well);

  const wellStateStr = typeof wellStateRaw === "string" ? wellStateRaw : "";
  const wsState: ProcessState = WELL_STATE_TO_PROCESS[wellStateStr] ?? "stale";

  // Downtime (24h): count of SHUTDOWN samples. The demo dataset is sampled
  // at 1-minute resolution, so one sample == one minute and the count IS
  // the minutes spent shut in over the day. Computed over the FULL recorded
  // series — a fixed daily total, not a counter that advances with the
  // clock.
  const downtimeMin = useMemo(
    () =>
      wellStateSeries.reduce(
        (n, s) => n + (s === "SHUTDOWN" ? 1 : 0),
        0,
      ),
    [wellStateSeries],
  );

  const oil = typeof oilRaw === "number" ? oilRaw : null;
  const oilState = evaluateState(oil, getLimits("ft_oil", well));

  const handleOpen = () => {
    setActiveWell(well);
    navigateTo("oil-well-detail");
  };

  return (
    <button
      type="button"
      className="well-column"
      data-state={wsState}
      onClick={handleOpen}
      aria-label={`Open ${well} detail`}
    >
      <DerrickIcon className="well-column__derrick" />

      <div className="well-column__name">{well}</div>

      <div className="well-column__state" data-state={wsState}>
        {STATE_GLYPH[wsState] && (
          <span className="well-column__state-glyph" aria-hidden>
            {STATE_GLYPH[wsState]}
          </span>
        )}
        <span>{wellStateStr || "—"}</span>
      </div>

      <div className="well-column__metric">
        <span className="well-column__metric-label">Downtime (24h)</span>
        <span className="well-column__metric-value">
          {wellStateSeries.length > 0 ? formatMinutes(downtimeMin) : "—"}
        </span>
      </div>

      <div className="well-column__metric" data-state={oilState}>
        <span className="well-column__metric-label">Oil Rate</span>
        <span className="well-column__metric-value">
          {oil == null ? "—" : oil.toFixed(TAGS.ft_oil.decimals)}
          <span className="well-column__metric-unit">{TAGS.ft_oil.unit}</span>
        </span>
      </div>
    </button>
  );
}
