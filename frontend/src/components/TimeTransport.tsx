/**
 * TimeTransport — global simulation control bar.
 *
 * Replaces the ClockProbe debug component. Lives at the top of the app,
 * outside any display, full width. Reads and writes the same simStore
 * fields the probe did (playing, speed, simTime, window, togglePlay,
 * setSpeed, seek).
 *
 * Re-render contract (this is the load-bearing part):
 *
 *   - The outer TimeTransport subscribes ONLY to infrequent fields:
 *     playing, speed, windowStart, windowEnd. Buttons + theme toggle
 *     re-render at human cadence (clicks), never per frame.
 *
 *   - TimestampReadout is a tiny subchild that subscribes to simTime
 *     and renders one text node. ~60 Hz re-renders confined to a single
 *     <span>; React reconciliation cost is negligible.
 *
 *   - Scrubber is its own subchild that subscribes to simTime plus the
 *     window bounds. The <input range> re-renders at 60 Hz; that's one
 *     DOM node with no children, well within budget. Isolating it here
 *     means the button row beside it does NOT re-render.
 *
 * The theme toggle (isa101 / high-contrast) is APP-level state lifted
 * from App.tsx into this bar via props. The bar is the natural home
 * for app-chrome controls; the display itself owns no theme state.
 */

import { useSimStore } from "../sim/simStore";
import type { HmiThemeName } from "../theme/theme";
import "./TimeTransport.css";

const SPEED_PRESETS = [1, 5, 60];
const THEMES: HmiThemeName[] = ["isa101", "high-contrast"];

interface Props {
  theme: HmiThemeName;
  onThemeChange: (next: HmiThemeName) => void;
}

export function TimeTransport({ theme, onThemeChange }: Props) {
  // Primitive selectors only — re-render on clicks, not on frames.
  const playing = useSimStore((s) => s.playing);
  const speed = useSimStore((s) => s.speed);
  const togglePlay = useSimStore((s) => s.togglePlay);
  const setSpeed = useSimStore((s) => s.setSpeed);

  return (
    <div className="time-transport">
      <div className="time-transport__group">
        <button
          className="time-transport__btn"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "⏸" : "▶"}
        </button>
      </div>

      <div className="time-transport__group" role="group" aria-label="Speed">
        {SPEED_PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => setSpeed(p)}
            className={
              "time-transport__btn" +
              (speed === p ? " time-transport__btn--active" : "")
            }
          >
            {p}×
          </button>
        ))}
      </div>

      <Scrubber />

      <TimestampReadout />

      <div className="time-transport__theme">
        <span className="time-transport__theme-label">Theme</span>
        {THEMES.map((t) => (
          <button
            key={t}
            onClick={() => onThemeChange(t)}
            className={
              "time-transport__btn" +
              (theme === t ? " time-transport__btn--active" : "")
            }
            title={t}
          >
            {t === "isa101" ? "ISA" : "HC"}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Isolated subscriber: re-renders only the <span> when simTime changes.
 * The button rows above never re-render during playback.
 */
function TimestampReadout() {
  const simTime = useSimStore((s) => s.simTime);
  return <span className="time-transport__time">{fmt(simTime)}</span>;
}

/**
 * Isolated subscriber: scrubber owns its own re-render so the surrounding
 * controls stay still. Reading windowStart/windowEnd here is cheap (both
 * change only at DataBoot).
 */
function Scrubber() {
  const simTime = useSimStore((s) => s.simTime);
  const windowStart = useSimStore((s) => s.windowStart);
  const windowEnd = useSimStore((s) => s.windowEnd);
  const seek = useSimStore((s) => s.seek);

  return (
    <input
      type="range"
      className="time-transport__scrubber"
      min={windowStart}
      max={windowEnd}
      value={simTime}
      onChange={(e) => seek(Number(e.target.value))}
      aria-label="Scrub simulation time"
    />
  );
}

function fmt(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}
