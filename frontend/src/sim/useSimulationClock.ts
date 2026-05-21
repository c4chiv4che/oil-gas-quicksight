import { useEffect, useRef } from "react";
import { useSimStore, SPEED_BASE } from "./simStore";

/**
 * useSimulationClock
 *
 * El ÚNICO loop de la app. Se monta UNA sola vez en la raíz.
 *
 * Por qué requestAnimationFrame y no setInterval:
 *  - rAF está sincronizado con el repintado => animación fluida.
 *  - se pausa solo cuando la pestaña no es visible => no quema CPU.
 *  - nos da un timestamp preciso por frame.
 *
 * Por qué tiempo DERIVADO y no acumulado:
 *  - simTime se recalcula desde cero cada frame a partir del reloj real.
 *  - cero drift aunque la pestaña se congele y vuelva.
 *
 * Desacople reloj / datos:
 *  - el reloj (simTime) avanza suave y continuo en cada frame.
 *  - los DATOS se actualizan solo cuando simTime cruza al siguiente punto.
 *    Eso lo resuelve cada símbolo derivando su índice (binary search) de
 *    simTime; este hook NO renderiza datos, solo avanza el tiempo.
 */
export function useSimulationClock() {
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const loop = () => {
      const s = useSimStore.getState();

      if (s.playing) {
        const elapsedReal = performance.now() - s.anchorReal;
        const next = s.anchorSim + elapsedReal * SPEED_BASE * s.speed;

        if (next >= s.windowEnd) {
          // Llegamos al final: clamp y pausa automática.
          s._tick(s.windowEnd);
          s.pause();
        } else {
          s._tick(next);
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);
}
