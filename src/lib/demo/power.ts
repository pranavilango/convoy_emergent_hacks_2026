import {
  DAYS,
  formatTime,
  isOvernight,
  MINUTES_PER_DAY,
  summarizeHours,
  type WeeklyHours,
} from "./hours";

/**
 * Grid power and when a site can take in medicines.
 *
 * Where the grid is unreliable, a warehouse or clinic only has power part of the day, and without
 * power it can't keep medicines cold. So a site can take in deliveries only while it's both
 * staffed and powered. Solar power removes the power limit (not the staffing one): with solar,
 * a site takes in medicines whenever it's staffed.
 */

/** A daily span in whole hours, `from` inclusive to `until` exclusive: 0 ≤ from < until ≤ 24. */
export type HourWindow = { from: number; until: number };

/** The hours a site has grid power each day, the same every day. Null means a reliable grid. */
export type GridPower = HourWindow | null;

/** Eight hours a day: what a site on a rationed grid often gets. Used when limiting power. */
export const DEFAULT_LIMITED_POWER: HourWindow = { from: 8, until: 16 };

export function isHourWindow(value: unknown): value is HourWindow {
  if (typeof value !== "object" || value === null) return false;
  const { from, until } = value as Record<string, unknown>;
  return (
    Number.isInteger(from) &&
    Number.isInteger(until) &&
    (from as number) >= 0 &&
    (from as number) < (until as number) &&
    (until as number) <= 24
  );
}

export const windowHours = (window: HourWindow) => window.until - window.from;

/** "06:00–14:00", or "24 hours" for the whole day. */
export function formatWindow(window: HourWindow): string {
  if (window.from === 0 && window.until === 24) return "24 hours";
  return `${formatTime(window.from * 60)}–${formatTime(window.until * 60)}`;
}

/** "All day", or "06:00–14:00 (8 h a day)". */
export function formatPower(power: GridPower): string {
  if (power === null || windowHours(power) === 24) return "All day";
  return `${formatWindow(power)} (${windowHours(power)} h a day)`;
}

/**
 * The staffed hours the optimizer models: one daily span from the earliest opening to the latest
 * closing across the week, widened to whole hours. Null when the site is closed every day or has
 * an overnight shift (which a single daily span can't express).
 */
export function staffedWindow(hours: WeeklyHours): HourWindow | null {
  const ranges = DAYS.flatMap((day) => hours[day]);
  if (ranges.length === 0 || ranges.some(isOvernight)) return null;
  const opens = Math.min(...ranges.map((r) => r.open));
  const closes = Math.max(...ranges.map((r) => r.close));
  const window = {
    from: Math.floor(opens / 60),
    until: closes === MINUTES_PER_DAY ? 24 : Math.ceil(closes / 60),
  };
  return isHourWindow(window) ? window : null;
}

/** Working hours mid-sentence: "around the clock", "every day 08:00–20:00", "Mon–Fri …". */
export function describeStaffing(hours: WeeklyHours): string {
  const lines = summarizeHours(hours);
  if (lines.length === 1 && lines[0] === "Every day 24 hours") return "around the clock";
  return lines.map((line) => line.replace(/^Every day/, "every day")).join(", ");
}

export type ReceivingWindows = {
  staffed: HourWindow;
  /** Staffed and powered. Null when the site never has power while it's staffed: it can't take
   *  in medicines at all today. It's still analyzed; the optimizer counts it as the worst off. */
  today: HourWindow | null;
  /** With solar power, power is no longer the limit: the staffed hours. */
  withSolar: HourWindow;
};

/**
 * A warehouse or clinic that can't take in medicines at all today: it never has grid power while
 * it's staffed. It's still on the map and in the analysis (drawn in black and white until solar
 * powers it).
 */
export function cannotReceiveToday(site: {
  kind: string;
  hours: WeeklyHours;
  gridPower: GridPower;
}): boolean {
  if (site.kind === "port") return false;
  const windows = receivingWindows(site.hours, site.gridPower);
  return windows !== null && windows.today === null;
}

/** When a site can take in medicines today and with solar. Null if its hours can't be modelled. */
export function receivingWindows(hours: WeeklyHours, power: GridPower): ReceivingWindows | null {
  const staffed = staffedWindow(hours);
  if (!staffed) return null;
  const today = power
    ? { from: Math.max(staffed.from, power.from), until: Math.min(staffed.until, power.until) }
    : staffed;
  return { staffed, today: today.from < today.until ? today : null, withSolar: staffed };
}
