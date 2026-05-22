/**
 * EventsTable — live ESD phase log (PI Vision style).
 *
 * Renders ESD phases as a growing log: only phases whose phase_start
 * <= simTime appear (option B — no future preview). The phase whose
 * [phase_start, phase_end] window contains simTime is highlighted as
 * "active" — the operator sees which step of the shutdown sequence is
 * running right now, the same idea as Meridian's stop-sequence panel.
 *
 * Re-render contract: two primitive Zustand selectors (visibleCount,
 * activeIndex) gate React updates. Strict-equality on numbers means
 * the component re-renders only when a phase appears or the active
 * phase changes — at most ~12 times across the entire demo day, not
 * once per simTime tick.
 *
 * Today this component is bound to the ESD event source. To support
 * additional event streams (alarms, batch events, work orders…) the
 * shape would split into:
 *   - a generic <EventsTableView rows columns activeIndex /> presenter
 *   - per-source wrappers that map source rows -> column cells
 * Not built yet: one source, no need to pay the abstraction tax.
 */

import { useMemo, type CSSProperties } from "react";
import { useSimStore } from "../sim/simStore";
import { useEsdEventsCache } from "../data/dataSource";

/** Count of phases whose start <= target. Linear over a tiny array. */
function countLE(starts: number[], target: number): number {
  let n = 0;
  for (const v of starts) if (v <= target) n++;
  return n;
}

/** Index of the phase whose [start, end] contains target, else -1. */
function findActive(starts: number[], ends: number[], target: number): number {
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= target && target <= ends[i]) return i;
  }
  return -1;
}

/**
 * HH:MM:SS in UTC. The dataset's timestamps are stored as UTC (see
 * parseAthenaTs in dataSource), so we render the same wall-clock the
 * exporter wrote. Manual padding avoids toLocaleString locale drift.
 */
function formatTime(t: number): string {
  const d = new Date(t);
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/** Human duration: "1 min", "15 min", "6h", "5h 40min". */
function formatMinutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

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

  // Stable arrays for the selector closures. References change exactly
  // once (null→loaded) and stay stable afterwards, so the selectors
  // close over the same numbers for the lifetime of the page.
  const tStarts = useMemo(
    () => events?.map((e) => e.tStart) ?? [],
    [events],
  );
  const tEnds = useMemo(
    () => events?.map((e) => e.tEnd) ?? [],
    [events],
  );

  // Primitive selectors: Zustand short-circuits subscriber updates on
  // strict equality, so re-renders fire only when one of these numbers
  // changes — never per simTime tick.
  const visibleCount = useSimStore((s) => countLE(tStarts, s.simTime));
  const activeIndex = useSimStore((s) =>
    findActive(tStarts, tEnds, s.simTime),
  );

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
              const isActive = i === activeIndex;
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
