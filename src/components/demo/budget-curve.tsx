"use client";

import { useState } from "react";

import type { Location } from "@/lib/demo/types";
import type { BudgetStep } from "@/lib/solar-allocation/analyze";

/** Plot area insets, in % of the chart box: room for the end labels above and the dots' edges. */
const PAD_X = 5;
const PAD_TOP = 22;
const PAD_BOTTOM = 6;

const hours = (h: number) => `${h.toFixed(1)} h`;

/**
 * The budget curve: the population-weighted wait for supplies with no solar, then with the best
 * 1, 2, … units (the optimizer's answer at each budget). One thin aqua line from 0 h at the
 * bottom, labelled at its ends; hovering or focusing a point shows its sites below the chart.
 */
export function BudgetCurve({
  baselineHours,
  steps,
  locations,
}: {
  baselineHours: number;
  steps: BudgetStep[];
  locations: Location[];
}) {
  const points = [{ units: 0, selected: [] as string[], weighted_hours: baselineHours }, ...steps];
  const last = points.length - 1;
  const [active, setActive] = useState<number | null>(null);
  const shown = active ?? last;
  const name = new Map(locations.map((l) => [l.id, l.name]));
  const top = Math.max(...points.map((p) => p.weighted_hours), 1e-9);
  const x = (i: number) => PAD_X + (i / Math.max(last, 1)) * (100 - 2 * PAD_X);
  const y = (h: number) => PAD_TOP + (1 - h / top) * (100 - PAD_TOP - PAD_BOTTOM);
  const point = points[shown]!;

  return (
    <div className="space-y-2">
      <p className="text-xs text-white/60">
        Population-weighted wait for supplies, with the best sites for each number of solar units.
      </p>
      <div
        className="relative mt-5 aspect-[3/1] w-full sm:aspect-[5/1]"
        onMouseLeave={() => setActive(null)}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden
        >
          {/* 0 h: the baseline. */}
          <line
            x1={PAD_X}
            x2={100 - PAD_X}
            y1={y(0)}
            y2={y(0)}
            className="stroke-white/15"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {active !== null && (
            <line
              x1={x(active)}
              x2={x(active)}
              y1={PAD_TOP - 8}
              y2={y(0)}
              className="stroke-white/30"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
          <polyline
            points={points.map((p, i) => `${x(i)},${y(p.weighted_hours)}`).join(" ")}
            fill="none"
            className="stroke-aqua"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {points.map((p, i) => (
          <span
            key={p.units}
            aria-hidden
            className={`pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-aqua ring-2 ring-background ${
              i === shown ? "scale-125" : ""
            }`}
            style={{ left: `${x(i)}%`, top: `${y(p.weighted_hours)}%` }}
          />
        ))}

        {/* Direct labels at the two ends only. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -translate-y-[160%] font-mono text-[11px] whitespace-nowrap text-white/80"
          style={{ left: `${x(0) - 1}%`, top: `${y(points[0]!.weighted_hours)}%` }}
        >
          {hours(points[0]!.weighted_hours)}
        </span>
        {last > 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute -translate-x-full -translate-y-[160%] font-mono text-[11px] whitespace-nowrap text-white"
            style={{ left: `${x(last) + 1}%`, top: `${y(points[last]!.weighted_hours)}%` }}
          >
            {hours(points[last]!.weighted_hours)}
          </span>
        )}

        {/* Hit areas: a full-height column per point, much bigger than the dot. */}
        {points.map((p, i) => {
          const width = 100 / (last + 1);
          return (
            <button
              key={p.units}
              type="button"
              aria-label={`${p.units === 0 ? "No solar" : `${p.units} ${p.units === 1 ? "unit" : "units"}`}: ${hours(p.weighted_hours)}`}
              className="absolute top-0 h-full -translate-x-1/2 cursor-default rounded-sm outline-none focus-visible:outline-1 focus-visible:outline-aqua"
              style={{ left: `${x(i)}%`, width: `${width}%` }}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          );
        })}
      </div>

      {/* Units along the bottom, under their points. */}
      <div aria-hidden className="relative h-4 font-mono text-[10px] text-white/50">
        {points.map((p, i) => (
          <span
            key={p.units}
            // The last tick names the axis, right-aligned so it stays inside the chart.
            className={`absolute whitespace-nowrap ${i === last && last > 0 ? "-translate-x-[calc(100%-0.35em)]" : "-translate-x-1/2"}`}
            style={{ left: `${x(i)}%` }}
          >
            {i === last && last > 0 ? `${p.units} solar units` : p.units}
          </span>
        ))}
      </div>

      <p className="flex items-baseline gap-2 text-sm text-white/70" aria-live="polite">
        <span aria-hidden className="inline-block h-0.5 w-3 shrink-0 translate-y-[-3px] bg-aqua" />
        <span>
          <strong className="font-semibold text-white">{hours(point.weighted_hours)}</strong>{" "}
          {point.units === 0
            ? "with no solar"
            : `with ${point.units} ${point.units === 1 ? "unit" : "units"}: ${point.selected
                .map((id) => name.get(id) ?? id)
                .join(", ")}`}
        </span>
      </p>

      <table className="sr-only">
        <caption>Population-weighted wait for supplies by number of solar units</caption>
        <thead>
          <tr>
            <th scope="col">Solar units</th>
            <th scope="col">Weighted wait</th>
            <th scope="col">Sites with solar</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.units}>
              <td>{p.units}</td>
              <td>{hours(p.weighted_hours)}</td>
              <td>{p.selected.map((id) => name.get(id) ?? id).join(", ") || "None"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
