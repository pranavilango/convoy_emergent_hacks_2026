"use client";

import {
  cloneHours,
  DAY_LABELS,
  DAYS,
  dayError,
  formatTime,
  HOURS_PRESETS,
  timeOptions,
  type Day,
  type TimeRange,
  type WeeklyHours,
} from "@/lib/demo/hours";
import { cn } from "@/lib/utils";

import { Button, focusRing } from "./controls";
import { Select } from "./select";

const OPEN_TIMES = timeOptions({ includeEndOfDay: false });
const CLOSE_TIMES = timeOptions({ includeEndOfDay: true }).filter((m) => m > 0);
const FALLBACK_RANGE: TimeRange = { open: 9 * 60, close: 17 * 60 };

/**
 * Weekly hours: one open–close range per day, or closed. A close time earlier than the open
 * time runs past midnight (shown as "+1"). Presets fill the whole week in one click.
 */
export function HoursEditor({
  value,
  onChange,
}: {
  value: WeeklyHours;
  onChange: (hours: WeeklyHours) => void;
}) {
  function setDay(day: Day, ranges: TimeRange[]) {
    const next = cloneHours(value);
    next[day] = ranges;
    onChange(next);
  }

  function copyToAll(day: Day) {
    const next = cloneHours(value);
    for (const d of DAYS) next[d] = value[day].map((r) => ({ ...r }));
    onChange(next);
  }

  /** When opening a closed day, reuse the nearest earlier open day's hours. */
  function rangeForReopen(day: Day): TimeRange {
    const i = DAYS.indexOf(day);
    for (let k = 1; k < DAYS.length; k++) {
      const prev = value[DAYS[(i - k + DAYS.length) % DAYS.length]!][0];
      if (prev) return { ...prev };
    }
    return { ...FALLBACK_RANGE };
  }

  const firstOpenDay = DAYS.find((d) => value[d].length > 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {HOURS_PRESETS.map((preset) => (
          <Button
            key={preset.label}
            variant="outline"
            size="sm"
            onClick={() => onChange(cloneHours(preset.hours))}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      <ul className="divide-y divide-foreground/20 border-y border-foreground/30">
        {DAYS.map((day) => {
          // The UI edits one range per day; extra ranges (none are created here) are kept as-is.
          const ranges = value[day];
          const range = ranges[0];
          const error = dayError(ranges);
          const label = DAY_LABELS[day];
          return (
            <li key={day} className="py-1.5">
              <div className="grid grid-cols-[2.25rem_4.5rem_1fr] items-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-wider">{label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!range}
                  aria-label={`Open on ${label}`}
                  onClick={() => setDay(day, range ? [] : [rangeForReopen(day)])}
                  className={cn(
                    "rounded-sm border border-foreground px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                    range ? "border-brand bg-brand text-night" : "opacity-70 hover:opacity-100",
                    focusRing,
                  )}
                >
                  {range ? "Open" : "Closed"}
                </button>
                {range ? (
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                    <Select
                      compact
                      hideLabel
                      label={`${label} opens`}
                      value={String(range.open)}
                      onChange={(v) =>
                        setDay(day, [{ ...range, open: Number(v) }, ...ranges.slice(1)])
                      }
                      options={OPEN_TIMES.map((m) => ({ value: String(m), label: formatTime(m) }))}
                    />
                    <span aria-hidden className="font-mono text-xs">
                      →
                    </span>
                    <Select
                      compact
                      hideLabel
                      label={`${label} closes`}
                      value={String(range.close)}
                      onChange={(v) =>
                        setDay(day, [{ ...range, close: Number(v) }, ...ranges.slice(1)])
                      }
                      options={CLOSE_TIMES.map((m) => ({
                        value: String(m),
                        // Closing before opening means the shift runs past midnight.
                        label: `${formatTime(m)}${m < range.open ? " +1" : ""}`,
                      }))}
                    />
                  </div>
                ) : (
                  <span className="text-sm opacity-50">—</span>
                )}
              </div>
              {error && (
                <p role="alert" className="mt-1 pl-[7.25rem] text-xs">
                  {error}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {firstOpenDay && (
        <Button
          variant="ghost"
          className="font-mono text-[11px] uppercase tracking-wider"
          onClick={() => copyToAll(firstOpenDay)}
        >
          Copy {DAY_LABELS[firstOpenDay]} to every day
        </Button>
      )}
    </div>
  );
}
