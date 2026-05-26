/**
 * StaticTrend — a read-only uPlot time-series for the Analytics display.
 *
 * It is deliberately NOT TrendSymbol. TrendSymbol is bound to a well and the
 * simulation clock (60 Hz cursor subscription + a NaN-mask "reveal" that grows
 * the trace and re-pushes data once per simulated minute). These analytics
 * charts plot the full recorded day at once and never move with the clock, so
 * all of that machinery is dropped. What stays is the part that matters for
 * correctness:
 *
 *   - Fixed scales. x is pinned to [from, to]; y is passed as `range: [min,max]`
 *     (array form), which forces uPlot's sc.auto = false so a redraw can never
 *     re-autoscale the axis. Same trick TrendSymbol relies on.
 *
 *   - The ctx-cache rule. The band `drawClear` hook mutates ctx.fillStyle, which
 *     desyncs uPlot's internal ctx cache for the rest of a draw cycle. The fix
 *     is the same one documented in TrendSymbol: NEVER call u.redraw(). Since
 *     the data is static we never call setData/redraw at all; the only post-mount
 *     redraw path is ResizeObserver → u.setSize(), which reassigns the canvas
 *     width (blanking it and resetting the ctx cache), so the hook stays safe.
 *
 * Colors are read from CSS variables at mount (uPlot/canvas can't read them).
 * Like TrendSymbol, a theme toggle after mount does not repaint — same trade-off.
 */

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { readCssVar } from "../../theme/theme";
import "../../symbols/TrendSymbol.css";

export type StaticAxisSide = "left" | "right";

export interface StaticSeries {
  /** Y values aligned to the shared `tSec` x array. */
  values: number[];
  /** CSS variable for the stroke color, e.g. "--hmi-trace-a". */
  strokeVar: string;
  label?: string;
  axis?: StaticAxisSide;
  width?: number;
}

/** Horizontal background band on the LEFT y scale, [from, to] in data units. */
export interface YBand {
  from: number;
  to: number;
  /** CSS variable for the fill, e.g. "--state-ok" / "--state-alarm". */
  fillVar: string;
}

/** Vertical background band on the time axis, [fromMs, toMs] in epoch ms. */
export interface XBand {
  fromMs: number;
  toMs: number;
  fillVar: string;
}

interface Props {
  id: string;
  title?: string;
  /** x window start/end (epoch ms). Pinned to scales.x; never auto-derived. */
  fromMs: number;
  toMs: number;
  /** Shared x values in epoch SECONDS (uPlot's native unit when time = true). */
  tSec: number[];
  series: StaticSeries[];
  /** Fixed left/right y ranges. Array form → uPlot sc.auto = false. */
  yRangeLeft?: [number, number];
  yRangeRight?: [number, number];
  unitLeft?: string;
  unitRight?: string;
  /** Horizontal zones (left scale) — e.g. NAG-602 spec bands. */
  yBands?: YBand[];
  /** Vertical zones (time) — e.g. the ESD event window. */
  xBands?: XBand[];
  /** Canvas height in px (excludes the title strip). Default 220. */
  height?: number;
  /** Band opacity. Default 0.16 — tenue, sits behind grid + trace. */
  bandAlpha?: number;
}

export function StaticTrend({
  id,
  title,
  fromMs,
  toMs,
  tSec,
  series,
  yRangeLeft,
  yRangeRight,
  unitLeft,
  unitRight,
  yBands = [],
  xBands = [],
  height = 220,
  bandAlpha = 0.16,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!containerRef.current || tSec.length === 0) return;
    const container = containerRef.current;

    // Palette — read once at mount (canvas can't read CSS vars live).
    const textMuted = readCssVar("--hmi-text-muted") || "#8b919a";
    const border = readCssVar("--hmi-border") || "#2e333b";
    const resolve = (v: string, fallback: string) => readCssVar(v) || fallback;

    const hasRight = series.some((s) => s.axis === "right");

    const uSeries: uPlot.Series[] = [
      {}, // x
      ...series.map((s) => ({
        label: s.label ?? "",
        stroke: resolve(s.strokeVar, "#4a9eff"),
        width: s.width ?? 1.5,
        scale: s.axis === "right" ? "y2" : "y",
        points: { show: false },
        spanGaps: false,
      })),
    ];

    const axes: uPlot.Axis[] = [
      {
        // X — uPlot's default HH:MM formatting at minute/hour scale.
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
      x: { time: true, min: fromMs / 1000, max: toMs / 1000 },
      y: yRangeLeft ? { range: [yRangeLeft[0], yRangeLeft[1]] } : {},
    };
    if (hasRight) {
      scales.y2 = yRangeRight ? { range: [yRangeRight[0], yRangeRight[1]] } : {};
    }

    // Resolve band fills once. We never call redraw() (see file header), so the
    // ctx mutations these hooks make are confined to a single draw cycle and the
    // only post-mount repaint (setSize) resets the canvas + ctx cache anyway.
    const resolvedYBands = yBands.map((b) => ({
      from: b.from,
      to: b.to,
      color: resolve(b.fillVar, "#5aa775"),
    }));
    const resolvedXBands = xBands.map((b) => ({
      fromMs: b.fromMs,
      toMs: b.toMs,
      color: resolve(b.fillVar, "#ff5b5b"),
    }));

    const hooks: uPlot.Hooks.Arrays = {};
    if (resolvedYBands.length > 0 || resolvedXBands.length > 0) {
      hooks.drawClear = [
        (u) => {
          const { ctx } = u;
          const { left, top, width: w, height: h } = u.bbox;
          ctx.save();
          ctx.globalAlpha = bandAlpha;

          // Horizontal zones (left y scale). Pixel positions come from the
          // live scale via valToPos, then clamp to the plot rect so a zone
          // edge outside the visible range can't bleed into the axes.
          for (const z of resolvedYBands) {
            const yTop = u.valToPos(z.to, "y", true);
            const yBot = u.valToPos(z.from, "y", true);
            const clampedTop = Math.max(yTop, top);
            const clampedBot = Math.min(yBot, top + h);
            if (clampedBot <= clampedTop) continue;
            ctx.fillStyle = z.color;
            ctx.fillRect(left, clampedTop, w, clampedBot - clampedTop);
          }

          // Vertical bands (time axis), same clamping against the plot rect.
          for (const z of resolvedXBands) {
            const xL = u.valToPos(z.fromMs / 1000, "x", true);
            const xR = u.valToPos(z.toMs / 1000, "x", true);
            const clampedL = Math.max(xL, left);
            const clampedR = Math.min(xR, left + w);
            if (clampedR <= clampedL) continue;
            ctx.fillStyle = z.color;
            ctx.fillRect(clampedL, top, clampedR - clampedL, h);
          }

          ctx.restore();
        },
      ];
    }

    const initialWidth = Math.max(container.clientWidth, 320);
    const opts: uPlot.Options = {
      width: initialWidth,
      height,
      scales,
      axes,
      series: uSeries,
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
      tSec,
      ...series.map((s) => s.values),
    ] as uPlot.AlignedData;

    const u = new uPlot(opts, data, container);
    uplotRef.current = u;

    // Fill the parent width. setSize (not redraw) is the only post-mount
    // repaint path and it resets the ctx cache, keeping the band hook safe.
    const ro = new ResizeObserver(() => {
      const cw = container.clientWidth;
      const inst = uplotRef.current;
      if (!inst || cw <= 0) return;
      inst.setSize({ width: cw, height });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      u.destroy();
      uplotRef.current = null;
    };
  }, [
    id,
    title,
    fromMs,
    toMs,
    tSec,
    series,
    yRangeLeft,
    yRangeRight,
    unitLeft,
    unitRight,
    yBands,
    xBands,
    height,
    bandAlpha,
  ]);

  return (
    <div className="hmi-trend">
      {title && (
        <div
          style={{
            fontSize: "11px",
            color: "var(--hmi-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            marginBottom: "6px",
          }}
        >
          {title}
        </div>
      )}
      <div ref={containerRef} style={{ width: "100%" }} />
    </div>
  );
}
