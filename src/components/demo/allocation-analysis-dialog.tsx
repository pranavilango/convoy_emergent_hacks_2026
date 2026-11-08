"use client";

import type { KeyboardEvent, ReactNode } from "react";

import { distanceKm, formatDistance } from "@/lib/demo/geometry";
import { kindLabel } from "@/lib/demo/kinds";
import { peopleLabel } from "@/lib/demo/population";
import {
  describeStaffing,
  formatPower,
  formatWindow,
  receivingWindows,
  windowHours,
} from "@/lib/demo/power";
import type { Connection, Location } from "@/lib/demo/types";
import type { BudgetStep, SolarAllocation } from "@/lib/solar-allocation/analyze";
import { summarizeAnalysis } from "@/lib/solar-allocation/summary";

import { ClinicTimesTable, ImpactHeadline, ObviousComparison, TimeSplit } from "./analysis-figures";
import { AnalysisText } from "./analysis-text";
import { BudgetCurve } from "./budget-curve";
import { Button } from "./controls";
import { KindMark } from "./location-kinds";

export type AllocationAnalysisResult = {
  allocation: SolarAllocation;
  /** Best sites for 1, 2, … units (may be empty). */
  steps: BudgetStep[];
  analysis: string;
};

export function AllocationAnalysisDialog({
  status,
  result,
  locations,
  connections,
  error,
  onClose,
}: {
  status: "loading" | "ready" | "error";
  result: AllocationAnalysisResult | null;
  locations: Location[];
  connections: Connection[];
  error: string | null;
  onClose: () => void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || status === "loading") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/70 p-4 backdrop-blur-sm"
      onKeyDown={onKeyDown}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && status !== "loading") onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="allocation-dialog-title"
        className="my-auto max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-sm border border-white/15 bg-background p-6 text-foreground shadow-2xl md:p-8"
      >
        <div className="flex items-start justify-between gap-6 border-b border-foreground/30 pb-5">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider opacity-70">
              Chosen by Convoy&apos;s optimizer · explained by Gemini
            </p>
            <h2
              id="allocation-dialog-title"
              className="mt-2 text-3xl leading-tight tracking-[-0.04em]"
            >
              Network analysis
            </h2>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={status === "loading"}
            aria-label="Close network analysis"
            className="shrink-0"
          >
            Close
          </Button>
        </div>

        {status === "loading" && (
          <p role="status" className="py-8 text-sm">
            Optimizing the network and explaining the result…
          </p>
        )}

        {status === "error" && (
          <div role="alert" className="py-8">
            <p className="text-sm">{error}</p>
            <p className="mt-3 text-xs opacity-70">
              {error?.includes("Rust allocation service") ? (
                <>
                  Start it with <code>npm run dev:engine</code>, or remove{" "}
                  <code>MEDROUTE_API_URL</code> from the server&apos;s environment to use the
                  built-in engine.
                </>
              ) : error?.startsWith("Too many analyses") ? (
                "The public demo limits how often each visitor can analyze. Analyzing a network you already analyzed doesn't count."
              ) : error?.includes("Gemini") ? (
                "Check GEMINI_API_KEY and server network access, then try Analyze again."
              ) : (
                "Check the server configuration and try Analyze again."
              )}
            </p>
          </div>
        )}

        {status === "ready" && result && (
          <AnalysisResult result={result} locations={locations} connections={connections} />
        )}
      </section>
    </div>
  );
}

function Heading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="font-mono text-[11px] uppercase tracking-wider text-white/60">
      {children}
    </h3>
  );
}

/**
 * The optimizer's answer, in plain terms: how much sooner medicines reach clinics, where the time
 * goes, each clinic, the obvious alternative, the chosen sites, why, and what each unit buys.
 */
function AnalysisResult({
  result,
  locations,
  connections,
}: {
  result: AllocationAnalysisResult;
  locations: Location[];
  connections: Connection[];
}) {
  const { allocation, analysis } = result;
  const byId = new Map(locations.map((l) => [l.id, l]));
  const summary = summarizeAnalysis(allocation, locations, connections);
  const coversEverySite =
    allocation.selected.length < allocation.n &&
    allocation.selected.length === locations.filter((l) => l.kind !== "port").length
      ? allocation.selected.length
      : null;

  return (
    <div className="space-y-8 py-6">
      <section aria-labelledby="allocation-impact-title" className="space-y-3">
        <Heading id="allocation-impact-title">Estimated impact</Heading>
        <ImpactHeadline summary={summary} coversEverySite={coversEverySite} />
      </section>

      {summary.split && (
        <section aria-labelledby="allocation-split-title" className="space-y-3">
          <Heading id="allocation-split-title">Where the time goes</Heading>
          <TimeSplit split={summary.split} before={summary.before} after={summary.after} />
        </section>
      )}

      {summary.clinics && summary.clinics.length > 0 && (
        <section aria-labelledby="allocation-clinics-title" className="space-y-3">
          <Heading id="allocation-clinics-title">Clinic by clinic</Heading>
          <ClinicTimesTable summary={summary} />
        </section>
      )}

      {summary.obvious && summary.obvious.sites.length > 0 && (
        <section aria-labelledby="allocation-obvious-title" className="space-y-3">
          <Heading id="allocation-obvious-title">Versus the obvious choice</Heading>
          <ObviousComparison obvious={summary.obvious} after={summary.after} />
        </section>
      )}

      <section aria-labelledby="allocation-sites-title" className="space-y-3">
        <Heading id="allocation-sites-title">Chosen for solar</Heading>
        <ol className="divide-y divide-white/15 border-y border-white/15">
          {allocation.selected.map((id) => {
            const site = byId.get(id);
            if (!site) return null;
            const windows = receivingWindows(site.hours, site.gridPower);
            const gained = windows
              ? windowHours(windows.withSolar) - (windows.today ? windowHours(windows.today) : 0)
              : 0;
            const suppliers = connections
              .filter((c) => c.toId === id)
              .map((c) => byId.get(c.fromId))
              .filter((l): l is Location => l !== undefined);
            return (
              <li key={id} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 py-4">
                <KindMark kind={site.kind} className="mt-1" />
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-lg leading-tight tracking-tight">{site.name}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-white/60">
                      {kindLabel(site)}
                    </span>
                  </div>
                  {windows && (
                    <p className="text-sm text-white/75">
                      {windows.today
                        ? `Takes in medicines ${formatWindow(windows.today)}`
                        : "Can't take in medicines today"}{" "}
                      <span className="text-brand">
                        →{" "}
                        {windowHours(windows.withSolar) === 24
                          ? "around the clock"
                          : formatWindow(windows.withSolar)}{" "}
                        with solar{gained > 0 && ` (+${gained} h a day)`}
                      </span>
                    </p>
                  )}
                  <p className="text-xs text-white/60">
                    Staffed {describeStaffing(site.hours)} · Grid power{" "}
                    {formatPower(site.gridPower).toLowerCase()}
                  </p>
                  <p className="font-mono text-[11px] uppercase tracking-wider text-white/50">
                    {[
                      site.kind === "clinic" && site.population !== null
                        ? `Serves ${peopleLabel(site.population)}`
                        : null,
                      ...suppliers.map(
                        (s) => `From ${s.name} · ${formatDistance(distanceKm(s, site))}`,
                      ),
                    ]
                      .filter(Boolean)
                      .join("  ·  ")}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="allocation-explanation-title" className="space-y-3">
        <Heading id="allocation-explanation-title">Why these sites</Heading>
        <AnalysisText text={analysis} />
      </section>

      {result.steps.length > 0 && (
        <section aria-labelledby="allocation-curve-title" className="space-y-2">
          <Heading id="allocation-curve-title">Each extra solar unit</Heading>
          {/* A plain frame: sharp corners, one thin line. */}
          <div className="border border-white/20 p-4">
            <BudgetCurve
              baselineHours={allocation.baseline_weighted_hours}
              steps={result.steps}
              locations={locations}
            />
          </div>
        </section>
      )}

      <div className="space-y-1.5 border-t border-white/15 pt-4 text-xs leading-relaxed text-white/50">
        <p className="font-mono text-[10px] uppercase tracking-wider">How we estimate this</p>
        <p>
          We send a shipment from the port at every hour of the day. It travels in a straight line
          at 60 km/h and waits at the warehouse and then the clinic until each is staffed and has
          power to keep medicines cold. A clinic&apos;s time is the average of those 24 trips; the
          overall average counts bigger clinics more, by the people they serve. A site with no power
          while it&apos;s staffed counts as a full day&apos;s wait. These are model estimates: check
          them against real delivery records before committing funds.
        </p>
      </div>
    </div>
  );
}
