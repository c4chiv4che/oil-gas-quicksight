/**
 * EventsTable — live ESD phase log (PI Vision style).
 *
 * Renders ESD phases as a growing log: only phases whose phase_start
 * <= simTime appear (option B — no future preview). The phase whose
 * [phase_start, phase_end] window contains simTime is highlighted as
 * "active" — the operator sees which step of the shutdown sequence is
 * running right now, the same idea as Meridian's stop-sequence panel.
 *
 * Re-render contract: `visibleCount` and `activePhaseIndex` come from
 * the shared `useActiveEsdPhase` hook, where they live behind primitive
 * Zustand selectors. Strict-equality on numbers means this component
 * re-renders only when a phase appears or the active phase changes —
 * at most ~12 times across the entire demo day, not once per simTime
 * tick. The hook is the single source of truth for "ESD state derived
 * from simTime"; the banner consumes the same hook so the two views
 * cannot drift.
 *
 * Today this component is bound to the ESD event source. To support
 * additional event streams (alarms, batch events, work orders…) the
 * shape would split into:
 *   - a generic <EventsTableView rows columns activeIndex /> presenter
 *   - per-source wrappers that map source rows -> column cells
 * Not built yet: one source, no need to pay the abstraction tax.
 */

import { type CSSProperties } from "react";
import { useEsdEventsCache } from "../data/dataSource";
import { useActiveEsdPhase } from "../data/useActiveEsdPhase";
import { formatMinutes, formatTime } from "../utils/format";

const containerStyle: CSSProperties = {
  background: "var(--hmi-surface)",
  border: "1px solid var(--hmi-border)",
  borderRadius: "4px",
  padding: "12px 16px",
  fontFamily: "monospace",
};

const titleStyle: CSSProperties = {
  fontSize: "11px",
  color: "var(--hmi-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: "8px",
  fontVariantNumeric: "tabular-nums",
};

const thBase: CSSProperties = {
  padding: "4px 8px",
  fontSize: "10px",
  color: "var(--hmi-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  textAlign: "left",
  fontWeight: 400,
  borderBottom: "1px solid var(--hmi-border)",
  whiteSpace: "nowrap",
};

const tdBase: CSSProperties = {
  padding: "6px 8px",
  fontSize: "12px",
  whiteSpace: "nowrap",
};

export function EventsTable() {
  const events = useEsdEventsCache();
  // `events` is still read locally because the render needs the full
  // EsdEventRow per row (phase label, start, duration, reason). The
  // hook reads the same cache; both calls return the same cached
  // reference so there is no fetch duplication or drift.
  const { visibleCount, activePhaseIndex } = useActiveEsdPhase();

  const showPlaceholder = visibleCount === 0;
  // Distinguish "before any phase" from "still fetching" so the operator
  // does not stare at "No events" while the file is in flight.
  const placeholderText =
    events === null ? "Loading events…" : "No events";

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>Events</div>
      <table style={tableStyle}>
        <colgroup>
          {/* Narrow severity column; the rest size to content. */}
          <col style={{ width: "28px" }} />
          <col />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th style={thBase} aria-label="severity" />
            <th style={thBase}>Phase</th>
            <th style={thBase}>Start</th>
            <th style={thBase}>Duration</th>
            <th style={thBase}>Reason</th>
          </tr>
        </thead>
        <tbody>
          {showPlaceholder ? (
            <tr>
              <td
                colSpan={5}
                style={{
                  ...tdBase,
                  textAlign: "center",
                  padding: "24px 8px",
                  color: "var(--hmi-text-muted)",
                  fontStyle: "italic",
                  whiteSpace: "normal",
                }}
              >
                {placeholderText}
              </td>
            </tr>
          ) : (
            // events is non-null here: visibleCount > 0 requires a
            // populated tStarts, which only happens after the cache
            // resolved.
            events!.slice(0, visibleCount).map((e, i) => {
              const isActive = i === activePhaseIndex;
              const rowBg = isActive
                ? "var(--state-alarm-bg)"
                : "transparent";
              const phaseColor = isActive
                ? "var(--state-alarm)"
                : "var(--hmi-text)";
              return (
                <tr key={`${e.tStart}-${e.esd_phase}`}>
                  {/* Severity glyph: alarm-colored on every row (every
                      ESD phase is an alarm condition). The inset shadow
                      on the active row provides the extra "you are here"
                      bar without breaking border-collapse. */}
                  <td
                    style={{
                      ...tdBase,
                      background: rowBg,
                      color: "var(--state-alarm)",
                      textAlign: "center",
                      boxShadow: isActive
                        ? "inset 3px 0 0 var(--state-alarm)"
                        : "none",
                    }}
                  >
                    ●
                  </td>
                  <td
                    style={{
                      ...tdBase,
                      background: rowBg,
                      color: phaseColor,
                      fontWeight: isActive ? 500 : 400,
                    }}
                  >
                    {e.esd_phase}
                  </td>
                  <td
                    style={{
                      ...tdBase,
                      background: rowBg,
                      color: "var(--hmi-text)",
                    }}
                  >
                    {formatTime(e.tStart)}
                  </td>
                  <td
                    style={{
                      ...tdBase,
                      background: rowBg,
                      color: "var(--hmi-text)",
                    }}
                  >
                    {formatMinutes(e.minutes_in_phase)}
                  </td>
                  <td
                    style={{
                      ...tdBase,
                      background: rowBg,
                      color: "var(--hmi-text-muted)",
                    }}
                  >
                    {e.esd_reason || "—"}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
