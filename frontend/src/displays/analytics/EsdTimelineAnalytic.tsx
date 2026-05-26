/**
 * EsdTimelineAnalytic (ANALYTICS 1) — the ESD event as an analysis, not a live
 * sequence. Distinct from EsdSequence (which highlights the in-progress phase
 * on the Oil Well Detail): this view lays the whole 8→6-phase event flat and
 * overlays the two variables that tell its story — the HP flare spike and the
 * hot-oil supply collapse — so you see how both move ACROSS the phases.
 *
 * Time scale, declared honestly: HOLD lasts 340 min and would otherwise eat
 * ~80% of a real-time axis, crushing the fast phases (TRIP→…→UTILITIES_DOWN all
 * happen inside the first 19 min). So the phases are drawn as EQUAL-WIDTH
 * segments — and each segment is labeled with its REAL duration, so the time
 * distortion is disclosed, never hidden. The fine per-minute flare shape lives
 * in FlareAnalytic; this view is the per-phase comparison.
 *
 * Pure SVG (the "diagram/comparison" idiom, like EsdSequence and the gauges).
 * SVG can read CSS vars directly, so state colors come straight from
 * var(--state-*) — no canvas color resolution needed.
 */

import { useEsdEventsCache } from "../../data/dataSource";
import { evaluateState } from "../../theme/theme";
import { formatMinutes } from "../../utils/format";
import "./EsdTimelineAnalytic.css";

// SVG user-space canvas; scales to the container via viewBox + width:100%.
const W = 1000;
const H = 300;
const PAD_L = 92;
const PAD_R = 22;
const LABEL_TOP = 40; // phase name + duration band
// Flare sub-band (upper) and hot-oil sub-band (lower) plot rows.
const FLARE_TOP = 64;
const FLARE_BOT = 154;
const HOT_TOP = 196;
const HOT_BOT = 282;

// Local classification limits (these are plant/utility signals, not well tags,
// so they are not in tagConfig). Tuned to the ESD physics: a flare above
// ~50 Mm³/d is the depressurization spike; hot oil below 150 °C means the
// heater has dropped out.
const FLARE_LIMITS = { hiLimit: 5, hihiLimit: 50 };
const HOTOIL_LIMITS = { loloLimit: 150, loLimit: 200 };

export function EsdTimelineAnalytic() {
  const events = useEsdEventsCache();

  if (!events || events.length === 0) {
    return <div className="analytics-section__loading">Loading ESD event…</div>;
  }

  const n = events.length;
  const plotL = PAD_L;
  const plotR = W - PAD_R;
  const seg = (plotR - plotL) / n;
  const xc = (i: number) => plotL + (i + 0.5) * seg;

  // Flare scale: 0..peak with a little headroom so the top marker isn't clipped.
  const flarePeak = Math.max(...events.map((e) => e.peak_flare_hp_mm3d), 1);
  const flareMax = flarePeak * 1.08;
  const flareY = (v: number) =>
    FLARE_BOT - (v / flareMax) * (FLARE_BOT - FLARE_TOP);

  // Hot-oil scale: padded data range so the collapse to ~129 and the recovery
  // back toward ~259 both sit inside the band.
  const hotVals = events.flatMap((e) => [
    e.min_hotoil_supply_c,
    e.max_hotoil_supply_c,
  ]);
  const hotLo = Math.min(...hotVals) - 8;
  const hotHi = Math.max(...hotVals) + 8;
  const hotY = (v: number) =>
    HOT_BOT - ((v - hotLo) / (hotHi - hotLo)) * (HOT_BOT - HOT_TOP);

  const flarePts = events
    .map((e, i) => `${xc(i)},${flareY(e.peak_flare_hp_mm3d)}`)
    .join(" ");

  return (
    <div className="esd-tl">
      <svg
        className="esd-tl__svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="ESD event: flare and hot-oil across phases"
      >
        {/* Per-phase backgrounds + separators, tinted by each sub-band's state. */}
        {events.map((e, i) => {
          const fState = evaluateState(e.peak_flare_hp_mm3d, FLARE_LIMITS);
          const hState = evaluateState(e.min_hotoil_supply_c, HOTOIL_LIMITS);
          const x = plotL + i * seg;
          return (
            <g key={`bg-${e.tStart}`}>
              <rect
                className="esd-tl__cell"
                data-state={fState}
                x={x}
                y={FLARE_TOP}
                width={seg}
                height={FLARE_BOT - FLARE_TOP}
              />
              <rect
                className="esd-tl__cell"
                data-state={hState}
                x={x}
                y={HOT_TOP}
                width={seg}
                height={HOT_BOT - HOT_TOP}
              />
              {i > 0 && (
                <line
                  className="esd-tl__sep"
                  x1={x}
                  y1={LABEL_TOP}
                  x2={x}
                  y2={HOT_BOT}
                />
              )}
            </g>
          );
        })}

        {/* Sub-band baselines + left-gutter titles. */}
        <line className="esd-tl__axis" x1={plotL} y1={FLARE_BOT} x2={plotR} y2={FLARE_BOT} />
        <line className="esd-tl__axis" x1={plotL} y1={HOT_BOT} x2={plotR} y2={HOT_BOT} />
        <text className="esd-tl__band-title" x={8} y={FLARE_TOP + 12}>
          HP FLARE
        </text>
        <text className="esd-tl__band-unit" x={8} y={FLARE_TOP + 26}>
          Mm³/d
        </text>
        <text className="esd-tl__band-title" x={8} y={HOT_TOP + 12}>
          HOT OIL
        </text>
        <text className="esd-tl__band-unit" x={8} y={HOT_TOP + 26}>
          °C supply
        </text>

        {/* Phase headers: name + REAL duration (HOLD reads "5h 40min"). */}
        {events.map((e, i) => (
          <g key={`hdr-${e.tStart}`}>
            <text className="esd-tl__phase" x={xc(i)} y={18}>
              {e.esd_phase}
            </text>
            <text className="esd-tl__dur" x={xc(i)} y={32}>
              {formatMinutes(e.minutes_in_phase)}
            </text>
          </g>
        ))}

        {/* Flare trace: the spike-then-decay, markers colored by state. */}
        <polyline className="esd-tl__flare-line" points={flarePts} />
        {events.map((e, i) => {
          const fState = evaluateState(e.peak_flare_hp_mm3d, FLARE_LIMITS);
          return (
            <g key={`fl-${e.tStart}`}>
              <circle
                className="esd-tl__marker"
                data-state={fState}
                cx={xc(i)}
                cy={flareY(e.peak_flare_hp_mm3d)}
                r={3.5}
              />
              <text
                className="esd-tl__val"
                data-state={fState}
                x={xc(i)}
                y={flareY(e.peak_flare_hp_mm3d) - 7}
              >
                {e.peak_flare_hp_mm3d.toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* Hot oil: a [min..max] bar per phase (tall at RECOVERY = climbing back
            up), with the floor value labeled. Bar + floor colored by state. */}
        {events.map((e, i) => {
          const hState = evaluateState(e.min_hotoil_supply_c, HOTOIL_LIMITS);
          const yTop = hotY(e.max_hotoil_supply_c);
          const yBot = hotY(e.min_hotoil_supply_c);
          const barH = Math.max(yBot - yTop, 2);
          const barW = 10;
          return (
            <g key={`ho-${e.tStart}`}>
              <rect
                className="esd-tl__hot-bar"
                data-state={hState}
                x={xc(i) - barW / 2}
                y={yTop}
                width={barW}
                height={barH}
                rx={2}
              />
              <text
                className="esd-tl__val"
                data-state={hState}
                x={xc(i)}
                y={yBot + 14}
              >
                {e.min_hotoil_supply_c.toFixed(0)}
              </text>
            </g>
          );
        })}
      </svg>

      <p className="esd-tl__note">
        Phases are drawn equal-width for readability; each is labeled with its
        real duration (HOLD is{" "}
        {formatMinutes(events.find((e) => e.esd_phase === "HOLD")?.minutes_in_phase ?? 0)}
        ). Flare = per-phase peak; hot-oil bar spans each phase's min–max supply
        temperature.
      </p>
    </div>
  );
}
