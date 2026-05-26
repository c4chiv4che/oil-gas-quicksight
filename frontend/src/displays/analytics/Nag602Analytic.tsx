/**
 * Nag602Analytic (ANALYTICS 3) — fiscal gas-quality compliance against the
 * NAG-602 Tabla 1 spec.
 *
 * Two stacked panels (Wobbe and PCS sit on very different scales, so separate
 * frames read cleanest). Each plots the analyzer over the full recorded day
 * against its in-spec band:
 *   - Wobbe Index: in-spec 11300–12470 kcal/m³. The demo day runs ~12613–12802,
 *     i.e. ABOVE the upper limit all day → OFF-SPEC (the deliberate compliance
 *     alarm in the dataset).
 *   - PCS (gross heating value): in-spec 8850–10200 kcal/m³. The day runs
 *     ~9885–10033 → IN-SPEC.
 *
 * Limits are the project's source of truth: simulator/src/config.py:149-150 and
 * analytics/queries/04_nag602_compliance.sql.
 *
 * Band colors come from the multi-state engine (buildZones + evaluateState) but
 * are mapped to the COMPLIANCE palette: in-spec → --state-ok (green),
 * off-spec → --state-alarm (red). This is the compliance context, distinct from
 * live-operation symbols where "normal" stays grey (see theme.css --state-ok).
 */

import { useMemo } from "react";
import { usePlantEsdCache, type PlantEsdRow } from "../../data/dataSource";
import { buildZones, type ProcessState } from "../../theme/theme";
import { StaticTrend, type YBand, type StaticSeries } from "./StaticTrend";

const UNIT = "kcal/m³";

interface AnalyteSpec {
  key: "ai_wobbe" | "ai_pcs";
  label: string;
  /** NAG-602 in-spec band [lower, upper]. */
  lower: number;
  upper: number;
  /** Fixed, zoomed y axis so the band and the trace-vs-band relation show. */
  axis: [number, number];
}

const ANALYTES: AnalyteSpec[] = [
  { key: "ai_wobbe", label: "Wobbe Index", lower: 11300, upper: 12470, axis: [11000, 13000] },
  { key: "ai_pcs", label: "PCS (GHV)", lower: 8850, upper: 10200, axis: [8500, 10500] },
];

/** Compliance-context color for a zone state: in-spec (normal) → green,
 *  off-spec (alarm) → red. Warn/stale are not produced by a two-sided spec
 *  band but are mapped for completeness. */
function fillVarForState(state: ProcessState): string {
  switch (state) {
    case "normal":
      return "--state-ok";
    case "alarm":
      return "--state-alarm";
    case "warn":
      return "--state-warn";
    case "stale":
      return "--state-stale";
  }
}

export function Nag602Analytic() {
  const plant = usePlantEsdCache();

  if (!plant || plant.length === 0) {
    return (
      <div className="analytics-section__loading">Loading gas-quality data…</div>
    );
  }

  const fromMs = plant[0].t;
  const toMs = plant[plant.length - 1].t;
  const tSec = plant.map((r) => r.t / 1000);

  return (
    <div className="nag602">
      {ANALYTES.map((a) => (
        <AnalytePanel
          key={a.key}
          spec={a}
          plant={plant}
          tSec={tSec}
          fromMs={fromMs}
          toMs={toMs}
        />
      ))}
    </div>
  );
}

function AnalytePanel({
  spec,
  plant,
  tSec,
  fromMs,
  toMs,
}: {
  spec: AnalyteSpec;
  plant: PlantEsdRow[];
  tSec: number[];
  fromMs: number;
  toMs: number;
}) {
  const values = useMemo(() => plant.map((r) => r[spec.key]), [plant, spec.key]);

  // Spec band as multi-state zones over the full axis, then recolored for the
  // compliance palette. {lolo, hihi} = the two-sided spec, so below/above the
  // band classify as "alarm" (off-spec) and the band itself as "normal".
  const yBands = useMemo<YBand[]>(() => {
    const zones = buildZones(
      { loloLimit: spec.lower, hihiLimit: spec.upper },
      spec.axis[1],
    );
    return zones.map((z) => ({
      from: z.from,
      to: z.to,
      fillVar: fillVarForState(z.state),
    }));
  }, [spec]);

  const series = useMemo<StaticSeries[]>(
    () => [{ values, strokeVar: "--hmi-text", label: spec.label }],
    [values, spec.label],
  );

  // Verdict for the status chip — honest, derived from the data itself.
  const { min, max, offSpec } = useMemo(() => {
    let mn = Infinity;
    let mx = -Infinity;
    for (const v of values) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    return { min: mn, max: mx, offSpec: mn < spec.lower || mx > spec.upper };
  }, [values, spec]);

  return (
    <div className="nag602__panel">
      <div className="nag602__status" data-spec={offSpec ? "off" : "in"}>
        <span className="nag602__status-label">{spec.label}</span>
        <span className="nag602__status-spec">
          spec {spec.lower.toLocaleString()}–{spec.upper.toLocaleString()} {UNIT}
        </span>
        <span className="nag602__status-verdict">
          {offSpec ? "OFF-SPEC" : "IN-SPEC"}
        </span>
        <span className="nag602__status-range">
          observed {Math.round(min).toLocaleString()}–
          {Math.round(max).toLocaleString()}
        </span>
      </div>
      <StaticTrend
        id={`nag602-${spec.key}`}
        fromMs={fromMs}
        toMs={toMs}
        tSec={tSec}
        series={series}
        yRangeLeft={spec.axis}
        unitLeft={UNIT}
        yBands={yBands}
        height={180}
      />
    </div>
  );
}
