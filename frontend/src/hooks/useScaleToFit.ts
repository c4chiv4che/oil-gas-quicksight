/**
 * useScaleToFit — proportional zoom-out for fixed-width HMI shells.
 *
 * Why: the HMI is designed at a fixed 1366px width (faithful to how PI
 * Vision lays out a control-room display). On narrower viewports we
 * want to SCALE the whole display down proportionally — not reflow,
 * not rebreak the grid — so the spatial relationships an operator
 * learns stay intact.
 *
 * Why transform: scale and not zoom:
 *   transform is a compositor-level visual op. It does NOT change any
 *   element's layout box, so clientWidth / contentRect on every child
 *   stay the same. In particular, TrendSymbol's ResizeObserver (which
 *   triggers uPlot.setSize on layout changes) never fires from our
 *   scaling — uPlot is completely unaware of the transform, and the
 *   ctx-cache workaround documented in TrendSymbol stays in its safe
 *   regime. zoom would trigger that RO and is kept as a documented
 *   plan B if canvas softness at aggressive downscales ever matters.
 *
 * Loop avoidance:
 *   - Viewport width changes use a classic window 'resize' listener,
 *     NOT a body-level ResizeObserver — the listener fires only on
 *     true viewport changes and cannot loop with our wrapper.height
 *     writes.
 *   - We do observe the SHELL (not body, not the wrapper) so the
 *     scaled height stays in sync when ESD banner / sequence /
 *     injection panel grow or shrink content inside the shell. Our
 *     own writes go to wrapper.height; the wrapper is not observed,
 *     and writing wrapper.height does not change shell.offsetHeight
 *     (the shell has its own intrinsic content height), so no loop.
 */

import { useEffect, useRef } from "react";
import "./useScaleToFit.css";

/** Native design width — the size at which every layout was authored. */
const DESIGN_WIDTH = 1366;

export interface ScaleToFitRefs {
  /** Attach to the outer wrapper div (with className "hmi-scale-wrapper"). */
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  /** Attach to the inner shell (the 1366px element being scaled). */
  shellRef: React.RefObject<HTMLDivElement | null>;
}

export function useScaleToFit(): ScaleToFitRefs {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const shell = shellRef.current;
    if (!wrapper || !shell) return;

    const applyScale = () => {
      // Never scale up — at >= DESIGN_WIDTH the display renders at
      // native size. Below DESIGN_WIDTH it shrinks proportionally.
      const scale = Math.min(1, window.innerWidth / DESIGN_WIDTH);
      shell.style.transform = `scale(${scale})`;
      shell.style.transformOrigin = "top center";
      // Kill phantom vertical space: the shell's layout box still
      // claims its full unscaled height after transform. offsetHeight
      // reads that unscaled layout height (NOT affected by transforms
      // on self), so wrapper.height = unscaled * scale = visual.
      // Use the larger of offsetHeight and scrollHeight: belt-and-
      // suspenders against any future external constraint on the
      // shell's box. The primary defense is align-items: flex-start
      // on the wrapper (see CSS) which keeps the shell at its natural
      // content height; if anything ever caps the box, scrollHeight
      // still reports the true content size so the wrapper stays in
      // sync with what the user actually sees.
      const naturalHeight = Math.max(shell.offsetHeight, shell.scrollHeight);
      wrapper.style.height = `${naturalHeight * scale}px`;
    };

    applyScale();

    const onResize = () => applyScale();
    window.addEventListener("resize", onResize);

    // Observe only the shell. Content height changes (ESD banner /
    // sequence appearing, injection chips growing) need to retrigger
    // applyScale so the wrapper height stays correct.
    const ro = new ResizeObserver(() => applyScale());
    ro.observe(shell);

    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
    };
  }, []);

  return { wrapperRef, shellRef };
}
