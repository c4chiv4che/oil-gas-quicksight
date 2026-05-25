/**
 * ValueSymbol — first HMI symbol. Control-room HMI single-tag readout:
 * label on top, large value, unit on the side, glyph + color for the
 * process state.
 *
 * Dual encoding (color + glyph) is required by ISA-101: color alone
 * fails for colorblind operators and degrades in print/screenshot.
 *
 * Two flavors share the same box look:
 *   - Numeric tag: state via evaluateState(value, limits)
 *   - well_state: state via the categorical WELL_STATE_TO_PROCESS map
 *
 * Color always comes from CSS vars (--state-*) so the theme toggle
 * reskins this component without any prop change.
 */

import { useSeries } from "../data/useSeries";
import { TAGS, WELL_STATE_TO_PROCESS, getLimits } from "../data/tagConfig";
import { useAssetStore } from "../state/assetStore";
import {
  STATE_GLYPH,
  evaluateState,
  type ProcessState,
} from "../theme/theme";
import type { WellRow } from "../data/dataSource";

interface Props {
  tag: keyof WellRow;
  well?: string;
}

export function ValueSymbol({ tag, well }: Props) {
  if (tag === "well_state") return <WellStateValue well={well} />;
  return <NumericValue tag={tag} well={well} />;
}

function NumericValue({ tag, well }: { tag: keyof WellRow; well?: string }) {
  const def = TAGS[tag as string];
  // Resolve the well id here so limits and series read the same target.
  // Subscribing to activeWell adds no extra renders: Zustand short-circuits
  // on strict equality and activeWell changes only on user navigation.
  const activeWell = useAssetStore((s) => s.activeWell);
  const effectiveWell = well ?? activeWell;
  const { currentValue } = useSeries(tag, effectiveWell);
  // Narrow at runtime: useSeries returns the union of WellRow column
  // types; non-numeric callers belong on the other branch.
  const numeric = typeof currentValue === "number" ? currentValue : null;
  const state: ProcessState = evaluateState(
    numeric,
    getLimits(tag as string, effectiveWell),
  );
  const display =
    numeric == null ? "—" : numeric.toFixed(def?.decimals ?? 2);
  return (
    <ValueBox
      label={def?.label ?? String(tag)}
      value={display}
      unit={def?.unit ?? ""}
      state={state}
    />
  );
}

function WellStateValue({ well }: { well?: string }) {
  const { currentValue } = useSeries("well_state", well);
  const str = typeof currentValue === "string" ? currentValue : "";
  const state: ProcessState = WELL_STATE_TO_PROCESS[str] ?? "stale";
  return (
    <ValueBox
      label="Well state"
      value={str || "—"}
      unit=""
      state={state}
    />
  );
}

function ValueBox({
  label,
  value,
  unit,
  state,
}: {
  label: string;
  value: string;
  unit: string;
  state: ProcessState;
}) {
  const color = `var(--state-${state})`;
  const glyph = STATE_GLYPH[state];
  return (
    <div
      style={{
        background: "var(--hmi-surface)",
        border: "1px solid var(--hmi-border)",
        borderRadius: "4px",
        padding: "12px 16px",
        minWidth: "140px",
        fontFamily: "monospace",
      }}
    >
      <div
        style={{
          fontSize: "11px",
          color: "var(--hmi-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "6px",
          marginTop: "4px",
        }}
      >
        {glyph && (
          <span style={{ color, fontSize: "16px", lineHeight: 1 }}>
            {glyph}
          </span>
        )}
        <span
          style={{
            color,
            fontSize: "26px",
            fontWeight: 500,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </span>
        {unit && (
          <span
            style={{ fontSize: "12px", color: "var(--hmi-text-muted)" }}
          >
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
