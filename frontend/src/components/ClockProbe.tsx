import { useSimStore } from "../sim/simStore";

/**
 * TEST component for the time engine. Not part of the final HMI;
 * it exists only to validate the Module 1 milestone:
 *  - time advances smoothly
 *  - play/pause/speed re-anchor without jumps
 *  - clamping at the end works
 *
 * Now also consumes theme CSS variables, so it doubles as a check
 * that the theme toggle reaches components.
 *
 * Subscribing to raw simTime here forces a re-render per frame: that's
 * FINE for this probe (we want to see the clock move). Real symbols will
 * NOT subscribe to raw simTime but to the derived data index.
 */

const SPEED_PRESETS = [1, 5, 60];

function fmt(ms: number): string {
  if (!ms) return "--";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

export function ClockProbe() {
  const simTime = useSimStore((s) => s.simTime);
  const playing = useSimStore((s) => s.playing);
  const speed = useSimStore((s) => s.speed);
  const windowStart = useSimStore((s) => s.windowStart);
  const windowEnd = useSimStore((s) => s.windowEnd);

  const togglePlay = useSimStore((s) => s.togglePlay);
  const setSpeed = useSimStore((s) => s.setSpeed);
  const seek = useSimStore((s) => s.seek);

  const span = windowEnd - windowStart || 1;
  const progress = ((simTime - windowStart) / span) * 100;

  return (
    <div
      style={{
        fontFamily: "monospace",
        background: "var(--hmi-surface)",
        color: "var(--hmi-text)",
        padding: "24px",
        borderRadius: "8px",
        maxWidth: "640px",
        border: "1px solid var(--hmi-border)",
      }}
    >
      <div style={{ fontSize: "12px", color: "var(--hmi-text-muted)" }}>SIM CLOCK PROBE</div>
      <div style={{ fontSize: "32px", margin: "8px 0", letterSpacing: "1px" }}>
        {fmt(simTime)}
      </div>
      <div style={{ fontSize: "12px", color: "var(--hmi-text-muted)" }}>
        window: {fmt(windowStart)} → {fmt(windowEnd)}
      </div>

      <input
        type="range"
        min={windowStart}
        max={windowEnd}
        value={simTime}
        onChange={(e) => seek(Number(e.target.value))}
        style={{ width: "100%", margin: "16px 0" }}
      />
      <div style={{ fontSize: "11px", color: "var(--hmi-text-muted)" }}>
        {progress.toFixed(1)}%
      </div>

      <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
        <button onClick={togglePlay} style={btn}>
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        {SPEED_PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => setSpeed(p)}
            style={{
              ...btn,
              background: speed === p ? "var(--hmi-accent)" : "var(--hmi-surface)",
            }}
          >
            {p}×
          </button>
        ))}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "var(--hmi-surface)",
  color: "var(--hmi-text)",
  border: "1px solid var(--hmi-border-2)",
  borderRadius: "4px",
  padding: "8px 14px",
  cursor: "pointer",
  fontFamily: "monospace",
};
