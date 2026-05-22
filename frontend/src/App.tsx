import { useEffect, useMemo, useState } from "react";
import { useSimulationClock } from "./sim/useSimulationClock";
import { useSimStore } from "./sim/simStore";
import { useAssetStore } from "./state/assetStore";
import { loadWells, loadEsdEvents } from "./data/dataSource";
import { ClockProbe } from "./components/ClockProbe";
import { ValueSymbol } from "./symbols/ValueSymbol";
import { GaugeSymbol } from "./symbols/GaugeSymbol";
import { TrendSymbol } from "./symbols/TrendSymbol";
import { EventsTable } from "./symbols/EventsTable";
import type { TrendConfig } from "./symbols/trendConfig";
import type { HmiThemeName } from "./theme/theme";
import "./theme/theme.css";

export default function App() {
  // The clock is mounted ONCE, here at the root.
  useSimulationClock();

  const initWindow = useSimStore((s) => s.initWindow);
  const setWellList = useAssetStore((s) => s.setWellList);
  const windowStart = useSimStore((s) => s.windowStart);
  const windowEnd = useSimStore((s) => s.windowEnd);
  const [theme, setTheme] = useState<HmiThemeName>("isa101");

  // Demo trend config. Memoized so TrendSymbol's effect deps stay stable
  // across unrelated re-renders (theme toggle, etc.).
  const trendConfig = useMemo<TrendConfig | null>(() => {
    if (!windowStart || !windowEnd) return null;
    return {
      id: "demo-rates",
      title: "Production rates",
      from: windowStart,
      to: windowEnd,
      series: [
        { tag: "ft_oil", axis: "left" },
        { tag: "ft_gas", axis: "right" },
      ],
      showLimits: true,
    };
  }, [windowStart, windowEnd]);

  // Apply the selected theme to the root element so [data-hmi-theme]
  // CSS selectors take effect across the whole app.
  useEffect(() => {
    document.documentElement.setAttribute("data-hmi-theme", theme);
  }, [theme]);

  // DataBoot: the ONLY place data is loaded. Symbols read the cache
  // through useWellsCache() and never trigger fetches themselves.
  // Also drives the sim window from the actual data range so the
  // scrubber covers exactly the loaded samples.
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
    <div style={{ padding: "40px", minHeight: "100vh" }}>
      <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
        <span
          style={{
            color: "var(--hmi-text-muted)",
            fontFamily: "monospace",
            alignSelf: "center",
            fontSize: "12px",
          }}
        >
          THEME:
        </span>
        {(["isa101", "high-contrast"] as HmiThemeName[]).map((t) => (
          <button
            key={t}
            onClick={() => setTheme(t)}
            style={{
              background:
                theme === t ? "var(--hmi-accent)" : "var(--hmi-surface)",
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

      {/* Probe row — validates data → index → state → color → DOM. */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          marginTop: "24px",
          flexWrap: "wrap",
        }}
      >
        <ValueSymbol tag="whp" />
        <ValueSymbol tag="chp" />
        <ValueSymbol tag="tt_flow" />
        <ValueSymbol tag="well_state" />
      </div>

      {/* Gauge probe — radial dial, same tag/well wiring as the value box. */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          marginTop: "24px",
          flexWrap: "wrap",
        }}
      >
        <GaugeSymbol tag="whp" />
        <GaugeSymbol tag="pt_downhole" />
      </div>

      {/* Trend probe — two-series, multi-axis trend on activeWell. */}
      {trendConfig && (
        <div style={{ marginTop: "24px", maxWidth: "960px" }}>
          <TrendSymbol config={trendConfig} />
        </div>
      )}

      {/* Events probe — live ESD phase log. Grows as simTime crosses
          each phase_start; the active phase is highlighted. */}
      <div style={{ marginTop: "24px", maxWidth: "720px" }}>
        <EventsTable />
      </div>
    </div>
  );
}
