import { useEffect, useState } from "react";
import { useSimulationClock } from "./sim/useSimulationClock";
import { useSimStore } from "./sim/simStore";
import { ClockProbe } from "./components/ClockProbe";
import type { HmiThemeName } from "./theme/theme";
import "./theme/theme.css";

export default function App() {
  // The clock is mounted ONCE, here at the root.
  useSimulationClock();

  const initWindow = useSimStore((s) => s.initWindow);
  const [theme, setTheme] = useState<HmiThemeName>("isa101");

  // Apply the selected theme to the root element so [data-hmi-theme]
  // CSS selectors take effect across the whole app.
  useEffect(() => {
    document.documentElement.setAttribute("data-hmi-theme", theme);
  }, [theme]);

  useEffect(() => {
    // Test window: ESD on 2026-03-15 14:00, +/-2h around it.
    // (Later this will come from the real exported JSON.)
    const esd = Date.parse("2026-03-15T14:00:00Z");
    initWindow(esd - 2 * 3600_000, esd + 6 * 3600_000);
  }, [initWindow]);

  return (
    <div style={{ padding: "40px", minHeight: "100vh" }}>
      <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
        <span style={{ color: "var(--hmi-text-muted)", fontFamily: "monospace", alignSelf: "center", fontSize: "12px" }}>
          THEME:
        </span>
        {(["isa101", "high-contrast"] as HmiThemeName[]).map((t) => (
          <button
            key={t}
            onClick={() => setTheme(t)}
            style={{
              background: theme === t ? "var(--hmi-accent)" : "var(--hmi-surface)",
              color: "var(--hmi-text)",
              border: "1px solid var(--hmi-border-2)",
              borderRadius: "4px",
              padding: "6px 12px",
              cursor: "pointer",
              fontFamily: "monospace",
              fontSize: "12px",
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <ClockProbe />
    </div>
  );
}
