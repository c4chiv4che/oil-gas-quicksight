/**
 * DisplayRouter — root switch that picks the display to render based on
 * useDisplayStore.activeDisplay.
 *
 * Intentionally not a router: no URL, no history, no params. Adding a
 * new display is one case in the switch + one string literal in
 * `DisplayId`. When deep-linking is genuinely needed we will wire URL
 * sync as an isolated change, not retrofit a routing library here.
 */

import { useDisplayStore } from "../state/displayStore";
import { OilWellDetail } from "./OilWellDetail";
import { Overview } from "./Overview";
import { WellPadDetail } from "./WellPadDetail";

export function DisplayRouter() {
  const activeDisplay = useDisplayStore((s) => s.activeDisplay);
  switch (activeDisplay) {
    case "overview":
      return <Overview />;
    case "oil-well-detail":
      return <OilWellDetail />;
    case "well-pad-detail":
      return <WellPadDetail />;
  }
}
