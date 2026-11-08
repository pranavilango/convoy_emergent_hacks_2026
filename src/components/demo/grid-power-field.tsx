"use client";

import { useState } from "react";

import { formatTime, type WeeklyHours } from "@/lib/demo/hours";
import {
  DEFAULT_LIMITED_POWER,
  formatWindow,
  hasNoGridPower,
  receivingWindows,
  type GridPower,
  type HourWindow,
} from "@/lib/demo/power";

import { Segmented } from "./controls";
import { Select } from "./select";

const HOURS = Array.from({ length: 25 }, (_, h) => h);
const hourOption = (h: number) => ({ value: String(h), label: formatTime(h * 60) });

const MODES = [
  { value: "reliable", label: "All day" },
  { value: "limited", label: "Part of the day" },
] as const;

/**
 * Hours of grid power a site gets each day (the same every day), and what that means: a site
 * takes in medicines only while it's staffed and powered, and solar lifts the power limit.
 * "No grid power at all" is the same start and end time: ticking the box sets that, and picking
 * the same two times ticks it.
 */
export function GridPowerField({
  value,
  hours,
  onChange,
}: {
  value: GridPower;
  /** The site's working hours, to show when it can take in medicines. */
  hours: WeeklyHours;
  onChange: (power: GridPower) => void;
}) {
  const windows = value ? receivingWindows(hours, value) : null;
  const noPower = hasNoGridPower(value);
  // The last hours it did have power, to put back when "no power at all" is unticked.
  const [lastPowered, setLastPowered] = useState<HourWindow>(() =>
    value && !noPower ? value : DEFAULT_LIMITED_POWER,
  );
  if (value && !noPower && (value.from !== lastPowered.from || value.until !== lastPowered.until)) {
    setLastPowered(value);
  }

  return (
    <div className="space-y-2">
      <span className="block font-mono text-[11px] uppercase tracking-wider opacity-70">
        Grid power
      </span>
      <Segmented
        label="Grid power"
        value={value ? "limited" : "reliable"}
        options={MODES}
        onChange={(mode) => {
          if ((mode === "limited") === (value !== null)) return;
          onChange(mode === "limited" ? { ...lastPowered } : null);
        }}
      />
      {value && (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
          <Select
            compact
            hideLabel
            label="Power comes on"
            value={String(value.from)}
            options={HOURS.slice(0, 24).map(hourOption)}
            onChange={(v) => {
              const from = Number(v);
              // Keep the end if it's still at or after the start; otherwise give it an hour.
              onChange({ from, until: value.until >= from ? value.until : from + 1 });
            }}
          />
          <span aria-hidden className="font-mono text-xs">
            →
          </span>
          <Select
            compact
            hideLabel
            label="Power goes off"
            value={String(value.until)}
            // The start time itself means no power at all.
            options={HOURS.filter((h) => h >= value.from).map(hourOption)}
            onChange={(v) => onChange({ from: value.from, until: Number(v) })}
          />
        </div>
      )}
      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
        {/* A thin outlined box (like the page's other lines) that fills blue with a tick. */}
        <span className="relative inline-flex size-4 shrink-0">
          <input
            type="checkbox"
            checked={noPower}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? { from: lastPowered.from, until: lastPowered.from }
                  : { ...lastPowered },
              )
            }
            className="peer size-4 cursor-pointer appearance-none rounded-sm border border-foreground/70 bg-transparent transition-colors checked:border-brand checked:bg-brand hover:border-foreground focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          />
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none absolute inset-0 hidden size-4 text-night peer-checked:block"
          >
            <path d="M4 8.5 6.75 11 12 5.5" />
          </svg>
        </span>
        No grid power at all
      </label>
      {windows && (
        <p className="text-xs leading-relaxed opacity-80">
          {windows.today ? (
            <>Takes in medicines {formatWindow(windows.today)}, while staffed and powered. </>
          ) : (
            <>
              {noPower ? "No grid power at all" : "Never has power while it's staffed"}, so it
              can&apos;t take in medicines today. It&apos;s still analyzed, as one of the sites that
              need solar most.{" "}
            </>
          )}
          <span className="text-brand">With solar: {formatWindow(windows.withSolar)}.</span>
        </p>
      )}
    </div>
  );
}
