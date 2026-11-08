"use client";

import { formatTime, type WeeklyHours } from "@/lib/demo/hours";
import {
  DEFAULT_LIMITED_POWER,
  formatWindow,
  receivingWindows,
  type GridPower,
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
          onChange(mode === "limited" ? { ...DEFAULT_LIMITED_POWER } : null);
        }}
      />
      {value && (
        <>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
            <Select
              compact
              hideLabel
              label="Power comes on"
              value={String(value.from)}
              options={HOURS.slice(0, 24).map(hourOption)}
              onChange={(v) => {
                const from = Number(v);
                onChange({ from, until: Math.max(value.until, from + 1) });
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
              options={HOURS.filter((h) => h > value.from).map(hourOption)}
              onChange={(v) => onChange({ from: value.from, until: Number(v) })}
            />
          </div>
          {windows && (
            <p className="text-xs leading-relaxed opacity-80">
              {windows.today ? (
                <>Takes in medicines {formatWindow(windows.today)}, while staffed and powered. </>
              ) : (
                <>
                  Never has power while it&apos;s staffed, so it can&apos;t take in medicines today.
                  It&apos;s still analyzed, as one of the sites that need solar most.{" "}
                </>
              )}
              <span className="text-aqua">With solar: {formatWindow(windows.withSolar)}.</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}
