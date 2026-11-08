"use client";

import type { KeyboardEvent } from "react";

import type { SolarAllocation } from "@/lib/solar-allocation/analyze";
import { AnalysisText } from "./analysis-text";
import { Button } from "./controls";

export type AllocationAnalysisResult = {
  allocation: SolarAllocation;
  analysis: string;
};

export function AllocationAnalysisDialog({
  status,
  result,
  error,
  onClose,
}: {
  status: "loading" | "ready" | "error";
  result: AllocationAnalysisResult | null;
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
              _Temporary AI allocation
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
            Generating two 24/7 site recommendations with estimated wait times, then analyzing their
            JSON output…
          </p>
        )}

        {status === "error" && (
          <div role="alert" className="py-8">
            <p className="text-sm">{error}</p>
            <p className="mt-3 text-xs opacity-70">
              Check the server configuration and try Analyze again.
            </p>
          </div>
        )}

        {status === "ready" && result && (
          <div className="space-y-7 py-6">
            <AnalysisText text={result.analysis} />

            <section aria-labelledby="allocation-recommendations-title">
              <h3
                id="allocation-recommendations-title"
                className="font-mono text-[11px] uppercase tracking-wider opacity-70"
              >
                _Recommended 24/7 sites
              </h3>
              <p className="mt-2 text-sm leading-relaxed">{result.allocation.networkSummary}</p>
              <ol className="mt-4 divide-y divide-foreground/20 border-y border-foreground/20">
                {result.allocation.recommendations.map((recommendation) => (
                  <li key={recommendation.locationId} className="py-4">
                    <div className="flex items-baseline gap-3">
                      <span className="font-medium">{recommendation.locationName}</span>
                      <span className="ml-auto font-mono text-[10px] uppercase tracking-wider opacity-60">
                        {recommendation.kind} · 24/7
                      </span>
                    </div>
                    <p className="mt-2 font-mono text-xs">
                      Estimated supply wait: {recommendation.estimatedWaitHoursBefore} h before
                      {" → "}
                      {recommendation.estimatedWaitHoursAfter} h after
                    </p>
                    <p className="mt-1 text-sm leading-relaxed opacity-80">
                      {recommendation.rationale}
                    </p>
                  </li>
                ))}
              </ol>
            </section>

            {result.allocation.limitations.length > 0 && (
              <section aria-labelledby="allocation-limitations-title">
                <h3
                  id="allocation-limitations-title"
                  className="font-mono text-[11px] uppercase tracking-wider opacity-70"
                >
                  _Limitations
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
                  {result.allocation.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </section>
            )}

            <p className="border-t border-foreground/30 pt-4 text-xs leading-relaxed opacity-70">
              Wait times are hypothetical AI estimates, not measured outcomes. Validate them with
              actual supply records, staffing, demand, and operating costs before making changes.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
