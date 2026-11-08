"use client";

import type { KeyboardEvent, ReactNode } from "react";

import { distanceKm, formatDistance } from "@/lib/demo/geometry";
import { kindLabel } from "@/lib/demo/kinds";
import { formatPeopleHours, peopleLabel, totalClinicPopulation } from "@/lib/demo/population";
import {
  describeStaffing,
  formatPower,
  formatWindow,
  receivingWindows,
  windowHours,
} from "@/lib/demo/power";
import type { Connection, Location } from "@/lib/demo/types";
import type { BudgetStep, SolarAllocation } from "@/lib/solar-allocation/analyze";

import { AnalysisText } from "./analysis-text";
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
              _Chosen by Convoy&apos;s optimizer · explained by Gemini
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

const hours = (h: number) => `${h.toFixed(1)} h`;

function Heading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="font-mono text-[11px] uppercase tracking-wider text-white/60">
      {children}
    </h3>
  );
}

/** The optimizer's answer: the effect, the chosen sites, what each unit buys, and why. */
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
  const saved = allocation.baseline_weighted_hours - allocation.optimized_weighted_hours;
  const clinicPopulation = totalClinicPopulation(locations);
  const peopleHoursSaved = saved * clinicPopulation;
  const share =
    allocation.baseline_weighted_hours > 0 ? saved / allocation.baseline_weighted_hours : 0;
  const coversEverySite =
    allocation.selected.length < allocation.n &&
    allocation.selected.length === locations.filter((l) => l.kind !== "port").length;

  return (
    <div className="space-y-8 py-6">
      <section aria-labelledby="allocation-impact-title" className="space-y-2">
        <Heading id="allocation-impact-title">_Estimated impact</Heading>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="border border-white/15 p-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-white/60">
              People affected
            </p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-aqua">
              {peopleLabel(clinicPopulation)}
            </p>
            <p className="mt-1 text-xs text-white/60">Across all clinic populations</p>
          </div>
          <div className="border border-white/15 p-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-white/60">
              Hours saved per person
            </p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-aqua">{hours(saved)}</p>
            <p className="mt-1 text-xs text-white/60">
              Estimated average supply arrival time saved
            </p>
          </div>
        </div>
        <p className="text-sm text-white/70">
          Combined estimate:{" "}
          <span className="font-semibold text-aqua">{formatPeopleHours(peopleHoursSaved)}</span>
          <span className="font-semibold text-aqua">
            {` · ${hours(allocation.baseline_weighted_hours)} → ${hours(allocation.optimized_weighted_hours)} per person`}
            {share > 0 && ` · ${Math.round(share * 100)}% shorter`}
          </span>
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-white/60">
          <li>
            Model: population-weighted, averages departure times. Solar removes the grid-power
            limit, while staffing hours still apply.
          </li>
          {coversEverySite && (
            <li>
              Budget covers all{" "}
              <strong className="font-semibold text-aqua">
                {allocation.selected.length} eligible sites
              </strong>
              .
            </li>
          )}
        </ul>
      </section>

      <section aria-labelledby="allocation-sites-title" className="space-y-3">
        <Heading id="allocation-sites-title">_Chosen for solar</Heading>
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
                      Takes in medicines {windows.today ? formatWindow(windows.today) : "never"}{" "}
                      <span className="text-aqua">
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
        <Heading id="allocation-explanation-title">_Why these sites</Heading>
        <AnalysisText text={analysis} />
      </section>

      <p className="border-t border-white/15 pt-4 text-xs leading-relaxed text-white/50">
        Modelled estimates, not measurements: travel is a straight line at 60 km/h, a site takes in
        medicines only while it&apos;s staffed (its widest daily hours) and powered, and clinics
        count by the people they serve. Check them against real delivery records before committing
        funds.
      </p>
    </div>
  );
}
