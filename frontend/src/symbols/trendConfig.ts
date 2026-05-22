/**
 * trendConfig.ts — declarative description of a trend.
 *
 * A TrendSymbol RENDERS a TrendConfig. A new trend = another config,
 * not another component. Same pattern as tagConfig.ts for tag presentation.
 *
 * Phase 1 scope:
 *   - The per-series `well` is reserved but NOT honored: every series in
 *     a single trend reads from one well (the first series's well, or
 *     assetStore.activeWell). Mixing wells inside one trend (which would
 *     require timestamp unification) is intentionally deferred.
 *   - `color` per series is honored. When omitted, left-axis series fall
 *     back to --hmi-trace-a and right-axis series to --hmi-trace-b.
 *   - `showLimits` enables horizontal limit lines for the FIRST left-axis
 *     series only. Multi-series limit overlays are out of scope.
 */

import type { WellRow } from "../data/dataSource";

export type TrendAxisSide = "left" | "right";

export interface TrendSeriesConfig {
  tag: keyof WellRow;
  /** Reserved; Phase 1 uses one well per trend (see file header). */
  well?: string;
  axis: TrendAxisSide;
  /** Optional hex color override. Resolve via JS — uPlot cannot read CSS vars. */
  color?: string;
  /** Optional explicit Y bounds for this series' axis. When multiple series
   *  share an axis, the union of their explicit bounds is used. Falls back
   *  to tag-limit-derived range (lolo..hihi padded), then to data-derived. */
  yMin?: number;
  yMax?: number;
}

export interface TrendConfig {
  /** Stable id; used as React key and to gate uPlot re-mount. */
  id: string;
  /** Optional caption rendered above the plot. */
  title?: string;
  /** Window start (epoch ms). Pinned to scales.x.min; not auto-derived. */
  from: number;
  /** Window end (epoch ms). Pinned to scales.x.max. */
  to: number;
  /** One or more series. Group by `axis` for shared y scales. */
  series: TrendSeriesConfig[];
  /** Default true. Limit overlay applies to the first left-axis series.
   *  Ignored when bands are active (bands replace the dashed lines — same
   *  info, less ink). */
  showLimits?: boolean;
  /** When true, paints colored horizontal background bands derived from
   *  the single series' tag limits. Bands are a MONO-SERIES feature:
   *  multi-axis bands are ambiguous by construction (which series' limits
   *  decide the zones?), so this flag is silently ignored when
   *  series.length > 1. Default: inferred true when series.length === 1,
   *  false otherwise. When bands render, the dashed-limit overlay is
   *  suppressed to avoid duplicating the zone information. */
  showBands?: boolean;
}
