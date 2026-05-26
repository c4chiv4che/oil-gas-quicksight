/**
 * AnalyticsDisplay — a native analytics surface for the HMI: three charts
 * computed and rendered IN the front-end (uPlot + SVG) directly from the
 * recorded dataset JSON the app already serves. Not an embedded dashboard and
 * not a mock of one — these are the HMI's own charts over real data. (The
 * separate, optional QuickSight embedding path documented in the README is a
 * different, server-side capability and is unrelated to anything here.)
 *
 * Three stacked sections:
 *   1. ESD event timeline  — phase-flow of flare spike + hot-oil collapse (SVG)
 *   2. HP flare            — normal operation vs the ESD event (uPlot)
 *   3. NAG-602 compliance  — fiscal gas quality vs spec bands (uPlot)
 *
 * Data is LAZY-loaded here, on mount — the per-minute plant/utilities files
 * (~556 KB together) are paid only when this display is opened, never on the
 * Overview boot path. The loaders are idempotent/promise-cached, so this is the
 * display's single legitimate call site, mirroring how App owns the wells load.
 *
 * Same fixed-1366px shell + useScaleToFit as the other displays (with the
 * load-bearing align-items: flex-start on .hmi-scale-wrapper).
 */

import { useEffect, type ReactNode } from "react";
import { useDisplayStore } from "../state/displayStore";
import { useScaleToFit } from "../hooks/useScaleToFit";
import {
  loadUtilitiesEsd,
  loadPlantEsd,
  loadEsdEvents,
} from "../data/dataSource";
import { EsdTimelineAnalytic } from "./analytics/EsdTimelineAnalytic";
import { FlareAnalytic } from "./analytics/FlareAnalytic";
import { Nag602Analytic } from "./analytics/Nag602Analytic";
import "./AnalyticsDisplay.css";

const PRODUCTION_AREA = "Vaca Muerta";

export function AnalyticsDisplay() {
  const navigateTo = useDisplayStore((s) => s.navigateTo);
  const { wrapperRef, shellRef } = useScaleToFit();

  // Lazy data boot for this display. Idempotent: re-entry returns the cached
  // promise/array. esd_events is also loaded by App, but calling it again is
  // free and keeps this display self-sufficient if reached first.
  useEffect(() => {
    loadUtilitiesEsd();
    loadPlantEsd();
    loadEsdEvents();
  }, []);

  return (
    <div className="hmi-scale-wrapper" ref={wrapperRef}>
      <div className="analytics-shell" ref={shellRef}>
        <div className="analytics-header">
          <button
            type="button"
            className="analytics-header__nav-back"
            onClick={() => navigateTo("overview")}
            aria-label="Back to Overview"
          >
            ← Overview
          </button>
          <div className="analytics-header__titles">
            <span className="analytics-header__area">{PRODUCTION_AREA}</span>
            <span className="analytics-header__sep" aria-hidden>
              ·
            </span>
            <span className="analytics-header__name">Analytics</span>
          </div>
          <span className="analytics-header__note">
            Native charts from the recorded dataset
          </span>
        </div>

        <Section
          title="ESD Event Timeline"
          subtitle="Flare spike & hot-oil collapse across the trip phases"
        >
          <EsdTimelineAnalytic />
        </Section>

        <Section
          title="HP Flare — Normal vs ESD"
          subtitle="Full recorded day; the ESD window is shaded"
        >
          <FlareAnalytic />
        </Section>

        <Section
          title="NAG-602 Gas Quality Compliance"
          subtitle="Fiscal Wobbe & PCS vs spec bands — in-spec (green) / off-spec (red)"
        >
          <Nag602Analytic />
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="analytics-section">
      <div className="analytics-section__head">
        <span className="analytics-section__title">{title}</span>
        {subtitle && (
          <span className="analytics-section__subtitle">{subtitle}</span>
        )}
      </div>
      {children}
    </section>
  );
}
