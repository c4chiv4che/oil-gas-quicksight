/**
 * EsdSequence — phase-duration summary of the in-progress ESD, in a
 * control-room HMI phase-summary style. Renders ALL N
 * phases as a row of KPI cells (1..N), each showing its name and
 * duration; the cell whose [tStart, tEnd] window contains simTime is
 * highlighted as ACTIVE (same alarm tint as EventsTable's active row).
 *
 * Why both EsdSequence and EventsTable exist (do not merge):
 *   - EsdSequence: full sequence, all phases visible at once, FUTURE
 *     phases dimmed but readable -> "this is what is going to happen
 *     and how long each step takes". A summary, not a log.
 *   - EventsTable: chronological live log, only past+current visible
 *     -> "this is what has already occurred". Same source data,
 *     different question.
 *
 * Visibility: gated on `inEsdRange` (same predicate as EsdBanner). In
 * normal operation the component returns null and contributes no grid
 * item, so the surrounding rows never shift when an ESD fires.
 *
 * Re-render contract: backed by `useActiveEsdPhase`'s primitive-equality
 * selectors -> re-renders only when activePhaseIndex / visibleCount /
 * inEsdRange transition (~handfuls of times across a whole ESD), not
 * per frame.
 */

import { useEsdEventsCache } from "../data/dataSource";
import { useActiveEsdPhase } from "../data/useActiveEsdPhase";
import { formatMinutes, formatTime } from "../utils/format";

export function EsdSequence() {
  const events = useEsdEventsCache();
  const { inEsdRange, activePhaseIndex, visibleCount } = useActiveEsdPhase();

  // ISA-101 quiet baseline: no ESD, no panel. Identical gating to
  // EsdBanner — both views appear and disappear together.
  if (!inEsdRange || !events || events.length === 0) return null;

  const reason = events[0].esd_reason || "—";
  const startedAt = formatTime(events[0].tStart);
  const n = events.length;

  return (
    <div className="esd-sequence" role="region" aria-label="ESD sequence">
      <div className="esd-sequence__head">
        <span className="esd-sequence__title">ESD SEQUENCE</span>
        <span className="esd-sequence__sep">·</span>
        <span>
          <span className="esd-sequence__k">Reason</span>
          <span className="esd-sequence__v">{reason}</span>
        </span>
        <span className="esd-sequence__sep">·</span>
        <span>
          <span className="esd-sequence__k">Started</span>
          <span className="esd-sequence__v">{startedAt}</span>
        </span>
      </div>
      {/* grid-template-columns is set inline because the column count
          depends on the dataset's phase count (events.length). Every
          other dimension lives in the CSS. */}
      <div
        className="esd-sequence__row"
        style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}
      >
        {events.map((e, i) => {
          // Three mutually-exclusive cell states. activePhaseIndex = -1
          // during micro-gaps between phases; visibleCount still
          // partitions past/future cleanly across that gap, so the
          // active cell simply disappears for a moment — which is
          // honest, no phase is "running" right then.
          const isActive = i === activePhaseIndex;
          const isFuture = !isActive && i >= visibleCount;
          const cls = [
            "esd-sequence__cell",
            isActive && "esd-sequence__cell--active",
            isFuture && "esd-sequence__cell--future",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div key={`${e.tStart}-${e.esd_phase}`} className={cls}>
              <div className="esd-sequence__step">{i + 1}</div>
              <div className="esd-sequence__phase">{e.esd_phase}</div>
              <div className="esd-sequence__dur">
                {formatMinutes(e.minutes_in_phase)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
