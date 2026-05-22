/**
 * EsdBanner — full-width SCADA-style declaration that an ESD is in
 * progress. Sits at the top of OilWellDetail (below the header, above
 * the value row) and answers "what is happening RIGHT NOW" without
 * forcing the operator to infer it from scattered symptoms — the
 * proactive-detection idea borrowed from Dominion/Meridian.
 *
 * Visibility is gated on `inEsdRange` from `useActiveEsdPhase`, not on
 * the phase index, so the banner stays up across the micro-gaps
 * between consecutive phases and never flickers.
 *
 * Style: no animation. ISA-101 reserves blinking for unacknowledged
 * alarms that need ack; this banner declares current state, so it is
 * prominent (alarm-tinted background, accent bar, glyph) but static.
 *
 * Re-render contract: the only sub-minute moving value the banner
 * subscribes to is `elapsedMinutes`, which the hook quantizes inside
 * its selector — so even at high sim-speeds this component re-renders
 * at most ~1×/sim-minute, never per frame.
 */

import { useActiveEsdPhase } from "../data/useActiveEsdPhase";
import { formatMinutes } from "../utils/format";

export function EsdBanner() {
  const { inEsdRange, activePhase, elapsedMinutes } = useActiveEsdPhase();
  if (!inEsdRange) return null;

  // In micro-gaps between phases `activePhase` is null. We deliberately
  // render "—" instead of holding the previous phase: showing a phase
  // that already finished would mislead the operator about what step
  // of the sequence is running. The banner itself stays up (gated on
  // inEsdRange) so the "ESD ACTIVE" declaration does not flicker.
  const phase = activePhase?.esd_phase ?? "—";
  const reason = activePhase?.esd_reason ?? "—";
  const elapsed = elapsedMinutes >= 0 ? formatMinutes(elapsedMinutes) : "—";

  return (
    <div className="esd-banner" role="alert">
      <span className="esd-banner__glyph" aria-hidden>
        ⚠
      </span>
      <span className="esd-banner__title">ESD ACTIVE</span>
      <span className="esd-banner__sep">·</span>
      <span>
        <span className="esd-banner__k">Phase</span>
        {phase}
      </span>
      <span className="esd-banner__sep">·</span>
      <span>
        <span className="esd-banner__k">Reason</span>
        {reason}
      </span>
      <span className="esd-banner__sep">·</span>
      <span>
        <span className="esd-banner__k">Elapsed</span>
        {elapsed}
      </span>
    </div>
  );
}
