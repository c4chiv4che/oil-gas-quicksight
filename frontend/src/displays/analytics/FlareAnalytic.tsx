/**
 * FlareAnalytic (ANALYTICS 2) — HP flare over the full recorded day, normal
 * operation vs the ESD event.
 *
 * The story is the contrast: the HP flare idles at ~0.3–0.6 Mm³/d almost all
 * day, then spikes to ~196 Mm³/d when the 14:00 ESD depressures the plant to
 * flare. A fixed 0..scaleMax axis keeps the baseline as a flat low line so the
 * spike dominates, and the ESD window is shaded so "normal vs event" reads at a
 * glance. Static chart — full day plotted at once, no clock coupling.
 */

import { useMemo } from "react";
import {
  useUtilitiesEsdCache,
  useEsdEventsCache,
} from "../../data/dataSource";
import { scaleMaxFor } from "../../theme/theme";
import { StaticTrend, type StaticSeries, type XBand } from "./StaticTrend";

const FLARE_UNIT = "Mm³/d";

export function FlareAnalytic() {
  const utils = useUtilitiesEsdCache();
  const events = useEsdEventsCache();

  const tSec = useMemo(
    () => (utils ? utils.map((r) => r.t / 1000) : []),
    [utils],
  );

  const series = useMemo<StaticSeries[]>(
    () =>
      utils
        ? [
            {
              values: utils.map((r) => r.ft_flare_hp),
              strokeVar: "--hmi-trace-a",
              label: "HP flare",
            },
          ]
        : [],
    [utils],
  );

  // Fixed top from the day's peak (≈196 → nice 250), so the idle baseline
  // stays a flat low line and the ESD spike fills the frame.
  const yRangeLeft = useMemo<[number, number]>(() => {
    const peak = utils
      ? utils.reduce((m, r) => Math.max(m, r.ft_flare_hp), 0)
      : 200;
    return [0, scaleMaxFor(peak)];
  }, [utils]);

  // Shade the ESD window: first phase start → last phase end.
  const xBands = useMemo<XBand[]>(() => {
    if (!events || events.length === 0) return [];
    return [
      {
        fromMs: events[0].tStart,
        toMs: events[events.length - 1].tEnd,
        fillVar: "--state-alarm",
      },
    ];
  }, [events]);

  const window = useMemo(() => {
    if (!utils || utils.length === 0) return null;
    return { fromMs: utils[0].t, toMs: utils[utils.length - 1].t };
  }, [utils]);

  if (!utils || !window) {
    return <div className="analytics-section__loading">Loading flare data…</div>;
  }

  return (
    <StaticTrend
      id="flare-day"
      title={`HP flare — normal vs ESD  ·  ${FLARE_UNIT}`}
      fromMs={window.fromMs}
      toMs={window.toMs}
      tSec={tSec}
      series={series}
      yRangeLeft={yRangeLeft}
      unitLeft={FLARE_UNIT}
      xBands={xBands}
      height={220}
    />
  );
}
