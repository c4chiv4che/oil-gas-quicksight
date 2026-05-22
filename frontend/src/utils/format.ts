/**
 * Shared display formatters for ESD/event UI.
 *
 * formatTime and formatMinutes were originally duplicated in EventsTable
 * and EsdBanner. Lifted here so EsdSequence (third consumer) does not
 * fork a third copy and the three views cannot drift on edge cases
 * (e.g. how "1h 0min" is rendered).
 */

/**
 * Whole sim-minutes -> human duration: "1 min", "15 min", "6h",
 * "5h 40min". Contract: non-negative integer input (minutes_in_phase or
 * a quantized elapsedMinutes). Fractional / negative inputs are not
 * supported and are not expected from any current caller.
 */
export function formatMinutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

/**
 * Epoch ms -> HH:MM:SS in UTC. The dataset's timestamps are stored as
 * UTC (parseAthenaTs in dataSource), so we render the same wall-clock
 * the exporter wrote. Manual padding avoids toLocaleString locale drift.
 */
export function formatTime(t: number): string {
  const d = new Date(t);
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}
