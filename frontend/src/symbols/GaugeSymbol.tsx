/**
 * GaugeSymbol — radial HMI gauge (manometer style).
 *
 * Sibling of ValueSymbol: same tag/well resolution, same limit-driven
 * state and dual encoding (color + glyph), but rendered as a 270° SVG
 * dial. Pure SVG, no canvas, no extra deps.
 *
 * Scale runs [0, hihiLimit] for the same reason TrendSymbol does — the
 * operator sees headroom to the upper alarm, and a SHUTDOWN value
 * collapses dramatically into the lower zone.
 *
 * Zones are classified by evaluateState() at each segment midpoint, so
 * the bands on the arc cannot diverge from the needle's state, and tags
 * with missing limits (e.g. risks with only hi/hihi) collapse naturally
 * to fewer segments without per-case branching.
 *
 * Performance: re-renders only when currentValue changes, via the
 * useSeries selector. Same contract as ValueSymbol — no frame loop.
 */

import { useSeries } from "../data/useSeries";
import { TAGS, getLimits } from "../data/tagConfig";
import { useAssetStore } from "../state/assetStore";
import {
  STATE_GLYPH,
  buildZones,
  evaluateState,
  type ProcessState,
} from "../theme/theme";
import type { WellRow } from "../data/dataSource";

interface Props {
  tag: keyof WellRow;
  well?: string;
  /**
   * Future expansion slot. Only "radial" is implemented today; a
   * "vertical" or "horizontal" gauge would reuse buildZones/valueToT
   * and swap the SVG layer.
   */
  variant?: "radial";
}

// ViewBox is 100x105: the arc bottom sits at y≈80 and the tick row
// needs room below it without crowding the centered readout.
const VB_W = 100;
const VB_H = 105;
const CX = 50;
const CY = 50;
const R_ARC = 37;       // centerline of the arc stroke
const ARC_WIDTH = 10;   // → inner edge r=32, outer edge r=42
const NEEDLE_R = 30;    // tip just inside the arc's inner edge
const HUB_R = 3;

// 270° dial opening downward. SVG y-down convention: angle 0 = right,
// 90 = down, 180 = left, 270 = up. START at 135° (8 o'clock = value
// minimum), sweep CW through the top to END at 405° = 45° (4 o'clock =
// value maximum).
const START_ANGLE = 135;
const END_ANGLE = 405;
const SWEEP_DEG = END_ANGLE - START_ANGLE;

// Defensive fallback when a tag declares no hihiLimit. No tag in the
// current registry hits this path, but a future risk-style tag added
// without limits would render a single neutral ring rather than crash.
const DEFAULT_SCALE_MAX = 100;

function degToRad(d: number) {
  return (d * Math.PI) / 180;
}

function pointOnCircle(cx: number, cy: number, r: number, angleDeg: number) {
  const a = degToRad(angleDeg);
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function valueToAngle(v: number, min: number, max: number) {
  if (max <= min) return START_ANGLE;
  const t = Math.max(0, Math.min(1, (v - min) / (max - min)));
  return START_ANGLE + t * SWEEP_DEG;
}

/**
 * SVG arc path between two angles on the same circle, sweeping CW.
 * largeArc flag flips above 180° so segments wider than a half-turn
 * still render correctly.
 */
function arcPath(
  cx: number,
  cy: number,
  r: number,
  a1: number,
  a2: number,
) {
  const p1 = pointOnCircle(cx, cy, r, a1);
  const p2 = pointOnCircle(cx, cy, r, a2);
  const largeArc = Math.abs(a2 - a1) > 180 ? 1 : 0;
  return `M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`;
}

export function GaugeSymbol({ tag, well, variant = "radial" }: Props) {
  // Reserved for future variant routing; consumed here to silence the
  // unused-prop warning while keeping the API surface stable.
  void variant;

  // Same well-resolution path as ValueSymbol so asset switches propagate
  // identically across both readouts.
  const activeWell = useAssetStore((s) => s.activeWell);
  const effectiveWell = well ?? activeWell;
  const { currentValue } = useSeries(tag, effectiveWell);

  const def = TAGS[tag as string];
  const numeric =
    typeof currentValue === "number" && Number.isFinite(currentValue)
      ? currentValue
      : null;
  const limits = getLimits(tag as string, effectiveWell);
  const state: ProcessState = evaluateState(numeric, limits);

  const scaleMax = limits.hihiLimit ?? DEFAULT_SCALE_MAX;
  const zones = buildZones(limits, scaleMax);

  const valueColor = `var(--state-${state})`;
  const decimals = def?.decimals ?? 2;
  const display = numeric === null ? "—" : numeric.toFixed(decimals);
  const label = def?.label ?? String(tag);
  const unit = def?.unit ?? "";
  const glyph = STATE_GLYPH[state];

  // Clamp into [0, scaleMax] so out-of-range values still render with
  // the needle pinned to the dial extreme.
  const needleAngle =
    numeric === null ? START_ANGLE : valueToAngle(numeric, 0, scaleMax);
  const needleTip = pointOnCircle(CX, CY, NEEDLE_R, needleAngle);

  return (
    <div
      style={{
        background: "var(--hmi-surface)",
        border: "1px solid var(--hmi-border)",
        borderRadius: "4px",
        padding: "12px 16px",
        minWidth: "180px",
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
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        style={{ display: "block", marginTop: "4px" }}
      >
        {/* Background track — full sweep in neutral border tone. */}
        <path
          d={arcPath(CX, CY, R_ARC, START_ANGLE, END_ANGLE)}
          fill="none"
          stroke="var(--hmi-border)"
          strokeWidth={ARC_WIDTH}
          strokeLinecap="butt"
        />
        {/* Colored zones on top of the track, desaturated so the needle stays dominant. */}
        {zones.map((z, i) => (
          <path
            key={i}
            d={arcPath(
              CX,
              CY,
              R_ARC,
              valueToAngle(z.from, 0, scaleMax),
              valueToAngle(z.to, 0, scaleMax),
            )}
            fill="none"
            stroke={`var(--state-${z.state})`}
            strokeOpacity={0.35}
            strokeWidth={ARC_WIDTH}
            strokeLinecap="butt"
          />
        ))}
        {/* Scale endpoints at the foot of the arc, dial-style. */}
        <text
          x={20}
          y={98}
          textAnchor="middle"
          fontSize={5}
          fill="var(--hmi-text-muted)"
        >
          0
        </text>
        <text
          x={80}
          y={98}
          textAnchor="middle"
          fontSize={5}
          fill="var(--hmi-text-muted)"
        >
          {scaleMax.toFixed(decimals)}
        </text>
        {/* Needle hidden when stale; the lone hub then signals "no value". */}
        {numeric !== null && (
          <line
            x1={CX}
            y1={CY}
            x2={needleTip.x}
            y2={needleTip.y}
            stroke={valueColor}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        )}
        <circle cx={CX} cy={CY} r={HUB_R} fill="var(--hmi-text)" />
        {/* Centered readout: glyph + value + unit on one baseline.
            `font-variant-numeric` has no SVG presentation attribute
            counterpart; passing it via `style` keeps the CSS property
            valid (CSS applies to SVG text) and type-checks cleanly. */}
        <text
          x={CX}
          y={72}
          textAnchor="middle"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {glyph && (
            <tspan fontSize={8} fill={valueColor}>
              {glyph}{" "}
            </tspan>
          )}
          <tspan fontSize={14} fill={valueColor} fontWeight={500}>
            {display}
          </tspan>
          {unit && (
            <tspan fontSize={5} dx={2} fill="var(--hmi-text-muted)">
              {unit}
            </tspan>
          )}
        </text>
      </svg>
    </div>
  );
}
