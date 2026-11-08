"use client";

import type { KeyboardEvent } from "react";

import type { Location } from "@/lib/demo/types";
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
  locations,
  error,
  onClose,
}: {
  status: "loading" | "ready" | "error";
  result: AllocationAnalysisResult | null;
  locations: Location[];
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
              _Rust optimizer + Gemini explanation
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
                  Start the Rust service with <code>cargo run --release</code>, then try Analyze
                  again.
                </>
              ) : error?.includes("Gemini") ? (
                "Check GEMINI_API_KEY and server network access, then try Analyze again."
              ) : (
                "Check the server configuration and try Analyze again."
              )}
            </p>
          </div>
        )}

        {status === "ready" && result && (
          <div className="space-y-7 py-6">
            <section aria-labelledby="allocation-impact-title">
              <h3
                id="allocation-impact-title"
                className="font-mono text-[11px] uppercase tracking-wider opacity-70"
              >
                _Weighted delivery-time reduction
              </h3>
              <p className="mt-3 font-mono text-3xl tracking-tight">
                {(
                  result.allocation.baseline_weighted_hours -
                  result.allocation.optimized_weighted_hours
                ).toFixed(2)}{" "}
                h
              </p>
              <p className="mt-2 text-sm leading-relaxed opacity-75">
                {result.allocation.baseline_weighted_hours.toFixed(2)} h before upgrades →{" "}
                {result.allocation.optimized_weighted_hours.toFixed(2)} h after upgrades
              </p>
            </section>

            <section aria-labelledby="allocation-recommendations-title">
              <h3
                id="allocation-recommendations-title"
                className="font-mono text-[11px] uppercase tracking-wider opacity-70"
              >
                _Selected 24/7 sites
              </h3>
              <p className="mt-2 text-sm leading-relaxed">
                Convoy selected {result.allocation.selected.length} of {result.allocation.n}{" "}
                requested solar units.
              </p>
              <ol className="mt-4 divide-y divide-foreground/20 border-y border-foreground/20">
                {result.allocation.selected.map((id) => {
                  const location = locations.find((item) => item.id === id);
                  return (
                    <li key={id} className="py-4">
                      <div className="flex items-baseline gap-3">
                        <span className="font-medium">{location?.name ?? id}</span>
                        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider opacity-60">
                          {location?.kind ?? "site"} · 24/7
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>

            <section aria-labelledby="allocation-explanation-title">
              <h3
                id="allocation-explanation-title"
                className="font-mono text-[11px] uppercase tracking-wider opacity-70"
              >
                _Why these sites
              </h3>
              <div className="mt-3">
                <AnalysisText text={result.analysis} />
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
