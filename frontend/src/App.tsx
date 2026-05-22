import { useEffect, useState } from "react";
import { useSimulationClock } from "./sim/useSimulationClock";
import { useSimStore } from "./sim/simStore";
import { useAssetStore } from "./state/assetStore";
import { loadWells, loadEsdEvents } from "./data/dataSource";
import { TimeTransport } from "./components/TimeTransport";
import { OilWellDetail } from "./displays/OilWellDetail";
import type { HmiThemeName } from "./theme/theme";
import "./theme/theme.css";

/**
 * App owns three things and nothing else:
 *   1. Mounting the simulation clock (rAF loop) ONCE at the root.
 *   2. DataBoot: the single place wells + ESD events are fetched. Also
 *      drives the sim window from the actual data range so the scrubber
 *      covers exactly the loaded samples.
 *   3. App-chrome state: the active visualization theme.
 *
 * It is intentionally display-agnostic. OilWellDetail is rendered
 * directly today; when a second display arrives, a tiny switch (or
 * router) will live here without touching DataBoot or the clock.
 */
export default function App() {
  useSimulationClock();

  const initWindow = useSimStore((s) => s.initWindow);
  const setWellList = useAssetStore((s) => s.setWellList);
  const [theme, setTheme] = useState<HmiThemeName>("isa101");

  // Apply the selected theme to the root element so [data-hmi-theme]
  // CSS selectors take effect across the whole app.
  useEffect(() => {
    document.documentElement.setAttribute("data-hmi-theme", theme);
  }, [theme]);

  // DataBoot: the ONLY place data is loaded. Symbols read the cache
  // through useWellsCache() and never trigger fetches themselves.
  useEffect(() => {
    loadWells().then((rows) => {
      if (rows.length === 0) return;
      const ids = Array.from(new Set(rows.map((r) => r.well_id))).sort();
      setWellList(ids);
      let min = rows[0].t;
      let max = rows[0].t;
      for (const r of rows) {
        if (r.t < min) min = r.t;
        if (r.t > max) max = r.t;
      }
      initWindow(min, max);
    });
    // Fire-and-forget: EventsTable subscribes to the cache itself.
    loadEsdEvents();
  }, [initWindow, setWellList]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--hmi-bg)" }}>
      <TimeTransport theme={theme} onThemeChange={setTheme} />
      <OilWellDetail />
    </div>
  );
}
