import { create } from "zustand";

/**
 * Store central de la simulación temporal.
 *
 * CONCEPTO CLAVE: el tiempo simulado NO se acumula tick a tick.
 * Se DERIVA del reloj real (performance.now()) en cada frame del loop rAF.
 * Esto elimina el drift y hace que play/pause/velocidad sean instantáneos
 * y sin saltos: solo "reanclamos" los dos timestamps de referencia.
 *
 *   simTime = anchorSim + (performance.now() - anchorReal) * speed
 *
 * El loop (useSimulationClock) es el ÚNICO que escribe simTime.
 * Todos los símbolos (gauges, trends, value, events table) leen de acá.
 */

export interface SimState {
  // --- Ventana de datos de la demo (epoch ms en tiempo simulado) ---
  /** Inicio de la ventana de datos cargada. */
  windowStart: number;
  /** Fin de la ventana de datos cargada. */
  windowEnd: number;

  // --- Estado del reloj ---
  /** Tiempo simulado actual (epoch ms). Lo que "ve" el resto de la app. */
  simTime: number;
  /** ¿Está corriendo el reloj? */
  playing: boolean;
  /** Multiplicador de velocidad. 1 => 1s real = 1s sim... ver SPEED_BASE. */
  speed: number;

  // --- Anclas internas para el cálculo derivado ---
  /** performance.now() en el momento del último reanclaje. */
  anchorReal: number;
  /** simTime en el momento del último reanclaje. */
  anchorSim: number;

  // --- Acciones ---
  /** Inicializa la ventana de datos y posiciona el reloj al inicio. */
  initWindow: (start: number, end: number) => void;
  /** Arranca la reproducción (reancla para no saltar). */
  play: () => void;
  /** Pausa la reproducción. */
  pause: () => void;
  /** Alterna play/pause. */
  togglePlay: () => void;
  /** Cambia la velocidad sin producir saltos (reancla). */
  setSpeed: (speed: number) => void;
  /** Salta a un tiempo simulado puntual (scrubbing manual). */
  seek: (simTime: number) => void;
  /**
   * Usado SOLO por el loop rAF: escribe el nuevo simTime calculado.
   * No reancla; el loop ya hizo la cuenta.
   */
  _tick: (simTime: number) => void;
  /** Reancla las referencias al estado actual (uso interno). */
  _reanchor: () => void;
}

/**
 * A velocidad 1x: 1 segundo real = 1 MINUTO simulado.
 * Así un evento de 6h (la ESD) se ve en ~6 minutos. Los presets de
 * velocidad multiplican sobre esta base.
 */
export const SPEED_BASE = 60_000 / 1_000; // 60000 ms sim por cada 1000 ms reales

export const useSimStore = create<SimState>((set, get) => ({
  windowStart: 0,
  windowEnd: 0,
  simTime: 0,
  playing: false,
  speed: 1,
  anchorReal: 0,
  anchorSim: 0,

  initWindow: (start, end) =>
    set({
      windowStart: start,
      windowEnd: end,
      simTime: start,
      anchorSim: start,
      anchorReal: performance.now(),
      playing: false,
    }),

  _reanchor: () =>
    set({
      anchorReal: performance.now(),
      anchorSim: get().simTime,
    }),

  play: () => {
    if (get().playing) return;
    // Si estamos al final, rebobinar al inicio antes de reproducir.
    const { simTime, windowEnd, windowStart } = get();
    const startFrom = simTime >= windowEnd ? windowStart : simTime;
    set({
      playing: true,
      simTime: startFrom,
      anchorSim: startFrom,
      anchorReal: performance.now(),
    });
  },

  pause: () => {
    if (!get().playing) return;
    set({ playing: false });
  },

  togglePlay: () => (get().playing ? get().pause() : get().play()),

  setSpeed: (speed) => {
    // Reanclar ANTES de cambiar la velocidad para que no haya salto.
    get()._reanchor();
    set({ speed });
  },

  seek: (simTime) => {
    const { windowStart, windowEnd } = get();
    const clamped = Math.min(Math.max(simTime, windowStart), windowEnd);
    set({
      simTime: clamped,
      anchorSim: clamped,
      anchorReal: performance.now(),
    });
  },

  _tick: (simTime) => set({ simTime }),
}));
