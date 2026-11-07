/**
 * Weekly working hours for a location.
 *
 * Times are minutes since midnight (0–1440), which is simple to serialise and to compute with
 * later (e.g. in the planning engine). A range whose `close` is earlier than its `open` runs past
 * midnight into the next day (e.g. 22:00–02:00). `close: 1440` means "until midnight".
 * A day with no ranges is closed.
 */

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];

export const DAY_LABELS: Record<Day, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

export type TimeRange = { open: number; close: number };
export type WeeklyHours = Record<Day, TimeRange[]>;

export const MINUTES_PER_DAY = 1440;
/** Granularity of the time pickers. */
export const TIME_STEP = 30;

const NINE_TO_FIVE: TimeRange = { open: 9 * 60, close: 17 * 60 };
const ALL_DAY: TimeRange = { open: 0, close: MINUTES_PER_DAY };

function week(make: (day: Day) => TimeRange[]): WeeklyHours {
  return Object.fromEntries(DAYS.map((d) => [d, make(d)])) as WeeklyHours;
}

const isWeekend = (d: Day) => d === "sat" || d === "sun";

export const HOURS_PRESETS = [
  { label: "Weekdays 9–5", hours: week((d) => (isWeekend(d) ? [] : [{ ...NINE_TO_FIVE }])) },
  { label: "Every day 9–5", hours: week(() => [{ ...NINE_TO_FIVE }]) },
  { label: "24/7", hours: week(() => [{ ...ALL_DAY }]) },
] as const;

export const DEFAULT_HOURS: WeeklyHours = HOURS_PRESETS[0].hours;

export function cloneHours(hours: WeeklyHours): WeeklyHours {
  return week((d) => hours[d].map((r) => ({ ...r })));
}

/** "09:00". 1440 renders as "24:00" so an end-of-day close is unambiguous. */
export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function isOvernight(range: TimeRange): boolean {
  return range.close < range.open;
}

export function formatRange(range: TimeRange): string {
  if (range.open === 0 && range.close === MINUTES_PER_DAY) return "24 hours";
  return `${formatTime(range.open)}–${formatTime(range.close)}${isOvernight(range) ? " (+1)" : ""}`;
}

export function rangeError(range: TimeRange): string | null {
  const { open, close } = range;
  if (!Number.isInteger(open) || !Number.isInteger(close)) return "Times must be whole minutes.";
  if (open < 0 || open >= MINUTES_PER_DAY) return "Opening time is out of range.";
  if (close < 0 || close > MINUTES_PER_DAY) return "Closing time is out of range.";
  if (open === close) return "Opening and closing times can't be the same.";
  if (close === 0) return "Use 24:00 for midnight.";
  return null;
}

/** Ranges within a day, as minute intervals on a 0–2880 line (overnight spills past 1440). */
function spans(ranges: TimeRange[]): [number, number][] {
  return ranges
    .map((r): [number, number] => [r.open, isOvernight(r) ? r.close + MINUTES_PER_DAY : r.close])
    .sort((a, b) => a[0] - b[0]);
}

/** First problem with a day's ranges, or null. */
export function dayError(ranges: TimeRange[]): string | null {
  for (const r of ranges) {
    const e = rangeError(r);
    if (e) return e;
  }
  const s = spans(ranges);
  for (let i = 1; i < s.length; i++) {
    if (s[i]![0] < s[i - 1]![1]) return "Time ranges overlap.";
  }
  return null;
}

export function hoursError(hours: WeeklyHours): string | null {
  for (const d of DAYS) {
    const e = dayError(hours[d]);
    if (e) return `${DAY_LABELS[d]}: ${e}`;
  }
  return null;
}

/** Validates hours from storage. Returns null if anything is malformed. */
export function parseHours(value: unknown): WeeklyHours | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const out = {} as WeeklyHours;
  for (const d of DAYS) {
    const raw = record[d];
    if (!Array.isArray(raw)) return null;
    const ranges: TimeRange[] = [];
    for (const r of raw) {
      if (typeof r !== "object" || r === null) return null;
      const { open, close } = r as Record<string, unknown>;
      if (typeof open !== "number" || typeof close !== "number") return null;
      ranges.push({ open, close });
    }
    out[d] = ranges;
  }
  return hoursError(out) ? null : out;
}

function sameDay(a: TimeRange[], b: TimeRange[]): boolean {
  return (
    a.length === b.length && a.every((r, i) => r.open === b[i]?.open && r.close === b[i]?.close)
  );
}

/**
 * Compact human summary: consecutive days with identical hours are grouped.
 * e.g. ["Mon–Fri 09:00–17:00", "Sat–Sun Closed"].
 */
export function summarizeHours(hours: WeeklyHours): string[] {
  const groups: { from: Day; to: Day; ranges: TimeRange[] }[] = [];
  for (const d of DAYS) {
    const last = groups.at(-1);
    if (last && sameDay(last.ranges, hours[d])) last.to = d;
    else groups.push({ from: d, to: d, ranges: hours[d] });
  }
  if (groups.length === 1 && groups[0]) {
    const only = groups[0];
    return [`Every day ${only.ranges.length ? only.ranges.map(formatRange).join(", ") : "Closed"}`];
  }
  return groups.map(({ from, to, ranges }) => {
    const days = from === to ? DAY_LABELS[from] : `${DAY_LABELS[from]}–${DAY_LABELS[to]}`;
    return `${days} ${ranges.length ? ranges.map(formatRange).join(", ") : "Closed"}`;
  });
}

/** Every selectable time of day, in TIME_STEP increments. */
export function timeOptions({ includeEndOfDay }: { includeEndOfDay: boolean }): number[] {
  const out: number[] = [];
  for (let m = 0; m < MINUTES_PER_DAY; m += TIME_STEP) out.push(m);
  if (includeEndOfDay) out.push(MINUTES_PER_DAY);
  return out;
}
