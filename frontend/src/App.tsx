import { useEffect } from "react";
import { useSimulationClock } from "./sim/useSimulationClock";
import { useSimStore } from "./sim/simStore";
import { ClockProbe } from "./components/ClockProbe";

export default function App() {
  // El reloj se monta UNA sola vez, acá en la raíz.
  useSimulationClock();

  const initWindow = useSimStore((s) => s.initWindow);

  useEffect(() => {
    // Ventana de prueba: ESD del 2026-03-15 14:00, ±2h alrededor.
    // (Después esto vendrá del JSON real exportado por el script.)
    const esd = Date.parse("2026-03-15T14:00:00Z");
    initWindow(esd - 2 * 3600_000, esd + 6 * 3600_000);
  }, [initWindow]);

  return (
    <div style={{ padding: "40px", background: "#050d1a", minHeight: "100vh" }}>
      <ClockProbe />
    </div>
  );
}
