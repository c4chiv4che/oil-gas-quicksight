import { useSimStore } from "../sim/simStore";

/**
 * Componente de PRUEBA del motor de tiempo. No es parte del HMI final;
 * existe solo para validar el hito del Módulo 1:
 *  - el tiempo avanza suave
 *  - play/pause/velocidad reanclan sin saltos
 *  - el clamp al final funciona
 *
 * Suscribirse a simTime acá fuerza re-render por frame: está BIEN para
 * esta prueba (queremos ver el reloj moverse). Los símbolos reales NO se
 * suscribirán a simTime crudo, sino al índice de dato derivado.
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
        background: "#0a1628",
        color: "#e8f0ff",
        padding: "24px",
        borderRadius: "8px",
        maxWidth: "640px",
      }}
    >
      <div style={{ fontSize: "12px", opacity: 0.6 }}>SIM CLOCK PROBE</div>
      <div style={{ fontSize: "32px", margin: "8px 0", letterSpacing: "1px" }}>
        {fmt(simTime)}
      </div>
      <div style={{ fontSize: "12px", opacity: 0.6 }}>
        ventana: {fmt(windowStart)} → {fmt(windowEnd)}
      </div>

      <input
        type="range"
        min={windowStart}
        max={windowEnd}
        value={simTime}
        onChange={(e) => seek(Number(e.target.value))}
        style={{ width: "100%", margin: "16px 0" }}
      />
      <div style={{ fontSize: "11px", opacity: 0.5 }}>
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
              background: speed === p ? "#1e6feb" : "#16243a",
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
  background: "#16243a",
  color: "#e8f0ff",
  border: "1px solid #2a3f5f",
  borderRadius: "4px",
  padding: "8px 14px",
  cursor: "pointer",
  fontFamily: "monospace",
};
