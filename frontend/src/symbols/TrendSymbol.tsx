/**
 * TrendSymbol — uPlot-based historian trend.
 *
 * Architecture contract (this is the whole point of the file):
 *
 *   1. uPlot is mounted ONCE per (config.id, view) pair. The chart's
 *      data is loaded with the full day at construction time. React
 *      re-renders here are infrequent (only when currentIndex crosses
 *      a sample boundary, i.e. ~once per simulated minute).
 *
 *   2. The cursor follows simTime at 60 Hz via an IMPERATIVE subscription
 *      to useSimStore — that callback runs OUTSIDE React's render cycle.
 *      It calls only u.setCursor(); no redraw, no setData.
 *
 *   3. The traza grows up to currentIndex via a NaN-mask. We keep a
 *      per-series number[] of the same length as the day. Indices ≤
 *      currentIndex hold real values; indices beyond hold NaN. uPlot
 *      draws gaps for NaN, so visually the line ends at the current
 *      sample. The mask is updated and pushed via u.setData(_, false)
 *      ONLY when currentIndex changes — once per simulated minute. The
 *      `false` keeps the x scale pinned to config.from/to (no jitter).
 *
 *   4. The 60 Hz subscription lives INSIDE the mount effect, so its
 *      cleanup runs before u.destroy() in the same effect. Belt-and-
 *      braces: we also null `uplotRef.current` in the cleanup, so any
 *      callback firing in the cleanup→remount gap is a no-op.
 *
 * Out of scope for Phase 1 (hooks left in the type but not wired):
 *   - per-state trace coloring, alarm-band fills, zoom/pan, sliding
 *     window, event-frame annotations, tooltips, interactive legend.
 *   - theme toggle re-skin: trace/grid colors are read at mount via
 *     readCssVar; switching themes after mount does NOT update them.
 *     Same trade-off the rest of the app would carry; address with a
 *     mode-aware effect when needed.
 */

import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useWellsCache } from "../data/dataSource";
import { useAssetStore } from "../state/assetStore";
import { useSimStore } from "../sim/simStore";
import { TAGS, getLimits } from "../data/tagConfig";
import { readCssVar } from "../theme/theme";
import type { TrendConfig, TrendSeriesConfig, TrendAxisSide } from "./trendConfig";
import "./TrendSymbol.css";

/** Outer wrapper height incl. title + padding. */
const WRAPPER_HEIGHT = 280;
/** Title strip allowance subtracted from uPlot canvas height. */
const TITLE_STRIP = 24;
/** Padding allowance subtracted from uPlot canvas height. */
const PADDING_Y = 24;

interface Props {
  config: TrendConfig;
}

interface ViewData {
  /** Sample timestamps in ms (for bsearch against simTime). */
  tMs: number[];
  /** Same in seconds (uPlot's native time unit when scale.x.time = true). */
  tSec: number[];
  /** Per-series raw numeric values, aligned to tMs/tSec. */
  series: number[][];
  /** Well id resolved at view-build time. */
  well: string;
}

/** Largest i with t[i] <= target; -1 if before window. Duplicate of useSeries
 *  helper, kept local so TrendSymbol does not depend on useSeries' single-tag
 *  shape (it needs N tags from the same well, not N hook calls).
 */
function bsearchLE(t: number[], target: number): number {
  const n = t.length;
  if (n === 0 || target < t[0]) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (t[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Data-derived fallback range. Used only when neither explicit bounds nor
 *  tag limits are available for any series on the axis.
 */
function dataRange(arrs: number[][]): { min: number; max: number } | null {
  let mn = Infinity;
  let mx = -Infinity;
  for (const a of arrs) {
    for (const v of a) {
      if (Number.isFinite(v)) {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
  }
  if (mn === Infinity) return null;
  if (mn === mx) {
    return { min: mn - 1, max: mx + 1 };
  }
  const pad = (mx - mn) * 0.1;
  return { min: mn - pad, max: mx + pad };
}

/** Round x UP to a "nice" axis bound. 77 → 80, 33 → 40, 7.7 → 8. Keeps ticks
 *  legible without forcing huge headroom (avoids the snapNumY 33→50 jump).
 */
function niceCeil(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return x;
  const exp = Math.floor(Math.log10(x));
  const pow = Math.pow(10, exp);
  const norm = x / pow;
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  for (const s of steps) {
    if (norm <= s + 1e-9) return s * pow;
  }
  return 10 * pow;
}

/** Resolve a fixed Y range for one axis, with precedence:
 *    1. Explicit yMin/yMax on any series on this axis (union).
 *    2. Tag limits via getLimits — union of [min(0, lolo), niceCeil(hihi*1.1)].
 *    3. Data-derived (full day, includes shutdown 0s).
 *  Returns null only when the axis has no series. Passing the result as
 *  `range: [min, max]` (array form) forces uPlot's sc.auto = false, so the
 *  axis is NEVER re-autoscaled by redraw() / setData / anything.
 */
function axisRange(
  axis: TrendAxisSide,
  series: TrendSeriesConfig[],
  data: number[][],
  well: string,
): { min: number; max: number } | null {
  const idxs: number[] = [];
  series.forEach((s, i) => {
    if (s.axis === axis) idxs.push(i);
  });
  if (idxs.length === 0) return null;

  const explicitMins = idxs
    .map((i) => series[i].yMin)
    .filter((v): v is number => v != null);
  const explicitMaxs = idxs
    .map((i) => series[i].yMax)
    .filter((v): v is number => v != null);
  if (explicitMins.length > 0 && explicitMaxs.length > 0) {
    return { min: Math.min(...explicitMins), max: Math.max(...explicitMaxs) };
  }

  const limMins: number[] = [];
  const limMaxs: number[] = [];
  for (const i of idxs) {
    const lim = getLimits(series[i].tag as string, well);
    if (lim.hihiLimit != null) {
      limMins.push(Math.min(0, lim.loloLimit ?? 0));
      limMaxs.push(niceCeil(lim.hihiLimit * 1.1));
    }
  }
  if (limMins.length === idxs.length) {
    return { min: Math.min(...limMins), max: Math.max(...limMaxs) };
  }

  return dataRange(idxs.map((i) => data[i]));
}

export function TrendSymbol({ config }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  // The masked y arrays that uPlot reads from. Mutated in place on
  // currentIndex change; never reallocated, never reassigned outside mount.
  const maskedRef = useRef<number[][]>([]);

  const wells = useWellsCache();
  const activeWell = useAssetStore((s) => s.activeWell);
  const resolvedWell = config.series[0]?.well ?? activeWell;

  // View: per-well rows + extracted columns. Rebuilds only on well swap or
  // when the series spec changes. config.series identity must be stable
  // (memoize at the call site) or this rebuilds unnecessarily.
  const view = useMemo<ViewData | null>(() => {
    if (!wells || config.series.length === 0) return null;
    const rows = wells.filter((r) => r.well_id === resolvedWell);
    if (rows.length === 0) return null;
    const n = rows.length;
    const tMs = new Array<number>(n);
    const tSec = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      tMs[i] = rows[i].t;
      tSec[i] = rows[i].t / 1000;
    }
    const series = config.series.map((s) =>
      rows.map((r) => r[s.tag] as number),
    );
    return { tMs, tSec, series, well: resolvedWell };
  }, [wells, resolvedWell, config.series]);

  // currentIndex: re-renders TrendSymbol ONLY when the index actually
  // changes. Zustand short-circuits on strict equality.
  const currentIndex = useSimStore((s) =>
    view ? bsearchLE(view.tMs, s.simTime) : -1,
  );

  // ── Mount/teardown uPlot + 60 Hz cursor subscription ───────────────────
  // Both live in the SAME effect so cleanup order is guaranteed: unsub
  // first, then destroy. Plus uplotRef = null at the end of cleanup so any
  // callback firing in the gap between cleanup and re-mount is a no-op.
  useEffect(() => {
    if (!view || !containerRef.current) return;
    const container = containerRef.current;

    // Theme palette — read once. Trace/grid/cursor colors are baked in for
    // the chart's lifetime; theme toggles after mount won't repaint.
    const traceA = readCssVar("--hmi-trace-a") || "#4a9eff";
    const traceB = readCssVar("--hmi-trace-b") || "#e8a317";
    const textMuted = readCssVar("--hmi-text-muted") || "#8b919a";
    const border = readCssVar("--hmi-border") || "#2e333b";
    const warn = readCssVar("--state-warn") || "#e8a317";
    const alarm = readCssVar("--state-alarm") || "#ff5b5b";

    // Initialise masked arrays. Pre-fill up to current sim index so the
    // chart appears already grown at mount instead of flashing empty.
    const initialIdx = bsearchLE(view.tMs, useSimStore.getState().simTime);
    const masked: number[][] = config.series.map((_, si) => {
      const dst = new Array<number>(view.tSec.length);
      const src = view.series[si];
      for (let i = 0; i < dst.length; i++) {
        dst[i] = i <= initialIdx ? src[i] : NaN;
      }
      return dst;
    });
    maskedRef.current = masked;

    // Axis units (label) for left/right groups.
    const firstLeft = config.series.find((s) => s.axis === "left");
    const firstRight = config.series.find((s) => s.axis === "right");
    const unitLeft = firstLeft
      ? (TAGS[firstLeft.tag as string]?.unit ?? "")
      : "";
    const unitRight = firstRight
      ? (TAGS[firstRight.tag as string]?.unit ?? "")
      : "";
    const hasRight = firstRight !== undefined;

    // Fixed y ranges per axis. Resolution: explicit yMin/yMax → tag limits →
    // data-derived. Passed below as `range: [min, max]` (array form), which
    // forces uPlot's sc.auto = false. Without this, redraw() puts the y
    // scales into AUTOSCALE on every fire (uPlot.esm.js setScales L3992-4001),
    // re-aggregating from revealed data — once the NaN mask uncovers
    // SHUTDOWN 0s, accScale pulls min down and snapNumY expands max outward
    // (45 → 60, 20 → 30). Array form skips that branch entirely.
    const rangeLeft = axisRange("left", config.series, view.series, view.well);
    const rangeRight = axisRange("right", config.series, view.series, view.well);

    // Limits overlay for the first left-axis series.
    const showLimits = config.showLimits !== false;
    const lim =
      showLimits && firstLeft
        ? getLimits(firstLeft.tag as string, view.well)
        : null;

    const series: uPlot.Series[] = [
      {}, // x
      ...config.series.map((s) => {
        const defaultColor = s.axis === "left" ? traceA : traceB;
        const def: uPlot.Series = {
          label: TAGS[s.tag as string]?.label ?? String(s.tag),
          stroke: s.color ?? defaultColor,
          width: 1.5,
          scale: s.axis === "left" ? "y" : "y2",
          points: { show: false },
          spanGaps: false,
        };
        return def;
      }),
    ];

    const axes: uPlot.Axis[] = [
      {
        // X axis — uPlot's default HH:MM formatting at minute scale.
        stroke: textMuted,
        grid: { stroke: border, width: 1 },
        ticks: { stroke: border, width: 1, size: 4 },
      },
      {
        scale: "y",
        side: 3,
        stroke: textMuted,
        grid: { stroke: border, width: 1 },
        ticks: { stroke: border, width: 1, size: 4 },
        label: unitLeft || undefined,
        labelSize: unitLeft ? 24 : 0,
        labelGap: 4,
      },
    ];
    if (hasRight) {
      axes.push({
        scale: "y2",
        side: 1,
        stroke: textMuted,
        grid: { show: false },
        ticks: { stroke: border, width: 1, size: 4 },
        label: unitRight || undefined,
        labelSize: unitRight ? 24 : 0,
        labelGap: 4,
      });
    }

    const scales: uPlot.Scales = {
      x: { time: true, min: config.from / 1000, max: config.to / 1000 },
      y: rangeLeft ? { range: [rangeLeft.min, rangeLeft.max] } : {},
    };
    if (hasRight) {
      scales.y2 = rangeRight
        ? { range: [rangeRight.min, rangeRight.max] }
        : {};
    }

    // Limits hook: draws horizontal dashed lines on the left ('y') scale.
    // Belongs in `draw` so it paints on top of the grid but is visually
    // distinct enough (dashed) not to obscure data.
    const hooks: uPlot.Hooks.Arrays = lim
      ? {
          draw: [
            (u) => {
              const { ctx } = u;
              const { left, top, width: w, height: h } = u.bbox;
              ctx.save();
              ctx.setLineDash([4, 4]);
              ctx.lineWidth = 1;
              const drawHLine = (val: number | undefined, color: string) => {
                if (val == null) return;
                const yPos = u.valToPos(val, "y", true);
                if (yPos < top || yPos > top + h) return;
                ctx.strokeStyle = color;
                ctx.beginPath();
                ctx.moveTo(left, yPos);
                ctx.lineTo(left + w, yPos);
                ctx.stroke();
              };
              drawHLine(lim.hihiLimit, alarm);
              drawHLine(lim.hiLimit, warn);
              drawHLine(lim.loLimit, warn);
              drawHLine(lim.loloLimit, alarm);
              ctx.restore();
            },
          ],
        }
      : {};

    const initialWidth = Math.max(container.clientWidth, 320);
    const opts: uPlot.Options = {
      width: initialWidth,
      height: WRAPPER_HEIGHT - TITLE_STRIP - PADDING_Y,
      scales,
      axes,
      series,
      cursor: {
        show: true,
        x: true,
        y: false,
        points: { show: false },
        drag: { x: false, y: false, setScale: false },
        focus: { prox: -1 },
      },
      legend: { show: false },
      hooks,
    };

    const data: uPlot.AlignedData = [
      view.tSec,
      ...masked,
    ] as uPlot.AlignedData;

    const u = new uPlot(opts, data, container);
    uplotRef.current = u;

    // Initial cursor placement to the current sim time.
    {
      const simT = useSimStore.getState().simTime;
      const xPx = u.valToPos(simT / 1000, "x", false);
      u.setCursor({ left: xPx, top: -10 }, false);
    }

    // 60 Hz imperative subscription. Co-located here so cleanup ordering
    // is unambiguous: unsub runs FIRST, then ResizeObserver, then destroy,
    // then the ref is nulled. Any further store fire after cleanup hits
    // the null guard below.
    const unsub = useSimStore.subscribe((state, prev) => {
      if (state.simTime === prev.simTime) return;
      const inst = uplotRef.current;
      if (!inst) return;
      const xPx = inst.valToPos(state.simTime / 1000, "x", false);
      inst.setCursor({ left: xPx, top: -10 }, false);
    });

    // Track container width so the chart fills its parent without
    // measuring synchronously on the parent's render path.
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const inst = uplotRef.current;
      if (!inst || w <= 0) return;
      inst.setSize({
        width: w,
        height: WRAPPER_HEIGHT - TITLE_STRIP - PADDING_Y,
      });
      // Re-place the cursor; setSize doesn't preserve our absolute left.
      const simT = useSimStore.getState().simTime;
      const xPx = inst.valToPos(simT / 1000, "x", false);
      inst.setCursor({ left: xPx, top: -10 }, false);
    });
    ro.observe(container);

    return () => {
      unsub();
      ro.disconnect();
      u.destroy();
      uplotRef.current = null;
      maskedRef.current = [];
    };
  }, [view, config.id, config.from, config.to, config.series, config.showLimits]);

  // ── Reveal up to currentIndex (per simulated minute) ───────────────────
  // Mutates the masked arrays in place and pushes via setData(_, false).
  // O(N) per fire, fires ~1×/simulated minute. Trivial.
  useEffect(() => {
    const u = uplotRef.current;
    if (!u || !view) return;
    const masked = maskedRef.current;
    if (masked.length !== view.series.length) return;
    const idx = currentIndex;
    for (let s = 0; s < masked.length; s++) {
      const dst = masked[s];
      const src = view.series[s];
      for (let i = 0; i < dst.length; i++) {
        dst[i] = i <= idx ? src[i] : NaN;
      }
    }
    u.setData([view.tSec, ...masked] as uPlot.AlignedData, false);
    // setSize (not redraw) because the limit-line draw hook leaves uPlot's ctx
    // cache (ctxStroke/ctxDash) out of sync with the real canvas state, so redraw
    // repaints with stale ctx and the trace comes out invisible. setSize reassigns
    // can.width which blanks the canvas and resets the ctx cache. Slightly more
    // expensive (full canvas rebuild ~1×/sim-minute) but correct. TODO: if the
    // draw hook can be fixed to not dirty uPlot's ctx cache, revert to redraw().
    u.setSize({ width: u.width, height: u.height });
  }, [currentIndex, view]);

  return (
    <div className="hmi-trend" style={{ height: WRAPPER_HEIGHT }}>
      {config.title && (
        <div
          style={{
            fontSize: "11px",
            color: "var(--hmi-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            marginBottom: "6px",
          }}
        >
          {config.title}
        </div>
      )}
      <div ref={containerRef} style={{ width: "100%" }} />
    </div>
  );
}
