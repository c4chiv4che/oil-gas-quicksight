/**
 * DisplayRouter — root switch that picks the display to render based on
 * useDisplayStore.activeDisplay.
 *
 * Intentionally not a router: no URL, no history, no params. Adding a
 * new display is one case in the switch + one string literal in
 * `DisplayId`. When deep-linking is genuinely needed we will wire URL
 * sync as an isolated change, not retrofit a routing library here.
 *
 * The placeholder for "overview" lives inline because it is a few
 * lines of throwaway markup; it gets replaced by the real Overview
 * display when that work lands, at which point we promote it to its
 * own file.
 */

import { useDisplayStore } from "../state/displayStore";
import { OilWellDetail } from "./OilWellDetail";

function OverviewPlaceholder() {
  const navigateTo = useDisplayStore((s) => s.navigateTo);
  return (
    <div
      style={{
        width: 1366,
        margin: "0 auto",
        padding: "48px 24px",
        color: "var(--hmi-text-muted)",
        fontFamily: "ui-monospace, monospace",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 14, letterSpacing: 1, textTransform: "uppercase" }}>
        Overview · coming soon
      </div>
      <button
        type="button"
        onClick={() => navigateTo("oil-well-detail")}
        style={{
          marginTop: 16,
          padding: "6px 12px",
          fontFamily: "inherit",
          fontSize: 12,
          color: "var(--hmi-text)",
          background: "var(--hmi-surface)",
          border: "1px solid var(--hmi-border)",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        Open Oil Well Detail
      </button>
    </div>
  );
}

export function DisplayRouter() {
  const activeDisplay = useDisplayStore((s) => s.activeDisplay);
  switch (activeDisplay) {
    case "overview":
      return <OverviewPlaceholder />;
    case "oil-well-detail":
      return <OilWellDetail />;
  }
}
