import { describe, expect, it } from "vitest";

import { unitsAffordable } from "@/lib/demo/budget";
import { ALWAYS_OPEN, cloneHours, DEFAULT_HOURS } from "@/lib/demo/hours";
import {
  cannotReceiveToday,
  formatPower,
  isHourWindow,
  receivingWindows,
  staffedWindow,
} from "@/lib/demo/power";
import { INITIAL_STATE, parseState, reducer } from "@/lib/demo/reducer";
import { createSampleNetwork } from "@/lib/demo/sample-network";
import type { Connection, DemoState, Location, NewLocation } from "@/lib/demo/types";
import { generateBudgetCurve, generateSolarAllocation } from "@/lib/solar-allocation/analyze";
import { analysisIssues } from "@/lib/solar-allocation/readiness";

/** Weekdays 09:00–17:00 (DEFAULT_HOURS). */
const weekdays = () => cloneHours(DEFAULT_HOURS);

describe("when a site can take in medicines", () => {
  it("is the staffed span, narrowed to the hours with power", () => {
    expect(staffedWindow(weekdays())).toEqual({ from: 9, until: 17 });
    expect(receivingWindows(weekdays(), { from: 6, until: 14 })).toEqual({
      staffed: { from: 9, until: 17 },
      today: { from: 9, until: 14 },
      withSolar: { from: 9, until: 17 },
    });
  });

  it("is the staffed span on a reliable grid, so solar adds nothing", () => {
    const w = receivingWindows(weekdays(), null);
    expect(w?.today).toEqual(w?.withSolar);
  });

  it("is never when power only comes while the site is closed", () => {
    expect(receivingWindows(weekdays(), { from: 18, until: 24 })?.today).toBeNull();
  });

  it("is around the clock with solar for a site staffed 24/7", () => {
    expect(receivingWindows(cloneHours(ALWAYS_OPEN), { from: 14, until: 22 })).toMatchObject({
      today: { from: 14, until: 22 },
      withSolar: { from: 0, until: 24 },
    });
  });

  it("can't be modelled for overnight shifts or sites closed every day", () => {
    const overnight = weekdays();
    overnight.mon = [{ open: 22 * 60, close: 2 * 60 }];
    expect(receivingWindows(overnight, null)).toBeNull();
    const closed = weekdays();
    for (const d of Object.keys(closed) as (keyof typeof closed)[]) closed[d] = [];
    expect(receivingWindows(closed, null)).toBeNull();
  });

  it("validates and formats power hours", () => {
    expect(isHourWindow({ from: 8, until: 16 })).toBe(true);
    for (const bad of [{ from: 8, until: 8 }, { from: -1, until: 4 }, { from: 2, until: 25 }, {}]) {
      expect(isHourWindow(bad)).toBe(false);
    }
    expect(formatPower(null)).toBe("All day");
    expect(formatPower({ from: 16, until: 24 })).toBe("16:00–24:00 (8 h a day)");
  });
});

const site = (id: string, kind: Location["kind"], extra: Partial<Location> = {}): Location => ({
  id,
  name: id.toUpperCase(),
  address: "",
  lat: 0,
  lng: 0,
  kind,
  portMode: kind === "port" ? "sea" : null,
  hours: kind === "port" ? cloneHours(ALWAYS_OPEN) : weekdays(),
  gridPower: kind === "port" ? null : { from: 8, until: 16 },
  population: kind === "clinic" ? 1000 : null,
  createdAt: "t",
  ...extra,
});
const links: Connection[] = [
  { id: "pw", fromId: "p", toId: "w" },
  { id: "wc", fromId: "w", toId: "c" },
];

describe("which sites the map draws in black and white", () => {
  it("is warehouses and clinics that never have power while they're staffed", () => {
    expect(cannotReceiveToday(site("c", "clinic", { gridPower: { from: 18, until: 24 } }))).toBe(
      true,
    );
    expect(cannotReceiveToday(site("w", "warehouse", { gridPower: { from: 0, until: 9 } }))).toBe(
      true,
    );
  });

  it("isn't a site with any powered staffed hour, a reliable grid, or a port", () => {
    expect(cannotReceiveToday(site("c", "clinic", { gridPower: { from: 16, until: 20 } }))).toBe(
      false,
    );
    expect(cannotReceiveToday(site("c", "clinic", { gridPower: null }))).toBe(false);
    expect(cannotReceiveToday(site("p", "port"))).toBe(false);
  });
});

describe("sites whose power and staffing don't line up", () => {
  const sites = (clinic: Partial<Location>) => [
    site("p", "port"),
    site("w", "warehouse"),
    site("c", "clinic", clinic),
  ];

  it("never block Analyze, even when a site is never powered while it's staffed", () => {
    // Power 18:00–24:00, staffed 09:00–17:00: no overlap at all.
    expect(analysisIssues(sites({ gridPower: { from: 18, until: 24 } }), links, 1)).toEqual([]);
    // Power 16:00–20:00: staffed and powered for a single hour.
    expect(analysisIssues(sites({ gridPower: { from: 16, until: 20 } }), links, 1)).toEqual([]);
    // Staffed for just one hour.
    const oneHour = weekdays();
    for (const d of ["mon", "tue", "wed", "thu", "fri"] as const) {
      oneHour[d] = [{ open: 9 * 60, close: 10 * 60 }];
    }
    expect(analysisIssues(sites({ hours: oneHour, gridPower: null }), links, 1)).toEqual([]);
  });

  it("still asks for power hours when no site has a power cut, since solar would change nothing", () => {
    const reliable = [
      site("p", "port"),
      site("w", "warehouse", { gridPower: null }),
      site("c", "clinic", { gridPower: null }),
    ];
    expect(analysisIssues(reliable, links, 1)).toEqual([
      "No site loses power during its working hours, so solar wouldn't shorten any waits. Set the grid power hours of sites with power cuts.",
    ]);
  });

  it("are run through the optimizer, which puts solar on a big clinic that can't take in medicines", async () => {
    // Two clinics off one warehouse. The big one is never powered while it's staffed.
    const locations = [
      site("p", "port", { lng: 0 }),
      site("w", "warehouse", { lng: 0.2, gridPower: { from: 6, until: 18 } }),
      site("big", "clinic", { lng: 0.4, population: 600_000, gridPower: { from: 18, until: 24 } }),
      site("small", "clinic", { lng: 0.6, population: 50_000, gridPower: { from: 12, until: 14 } }),
    ];
    const connections: Connection[] = [
      { id: "pw", fromId: "p", toId: "w" },
      { id: "wb", fromId: "w", toId: "big" },
      { id: "ws", fromId: "w", toId: "small" },
    ];
    expect(analysisIssues(locations, connections, 1)).toEqual([]);
    const allocation = await generateSolarAllocation({ locations, connections }, 1);
    expect(allocation.selected).toEqual(["big"]);
    expect(allocation.optimized_weighted_hours).toBeLessThan(allocation.baseline_weighted_hours);
  });

  it("include a site that's staffed and powered for only one hour", async () => {
    const locations = [
      site("p", "port"),
      site("w", "warehouse", { lng: 0.2 }),
      site("c", "clinic", { lng: 0.4, gridPower: { from: 16, until: 20 } }),
    ];
    const allocation = await generateSolarAllocation({ locations, connections: links }, 1);
    expect(allocation.selected).toHaveLength(1);
    expect(allocation.optimized_weighted_hours).toBeLessThan(allocation.baseline_weighted_hours);
  });
});

describe("grid power in the store", () => {
  const newSite = (kind: Location["kind"], gridPower: Location["gridPower"]): NewLocation => ({
    name: "Site",
    address: "a",
    lat: 0,
    lng: 0,
    kind,
    portMode: kind === "port" ? "sea" : null,
    hours: weekdays(),
    gridPower,
    population: kind === "clinic" ? 10 : null,
  });
  const add = (state: DemoState, id: string, location: NewLocation) =>
    reducer(state, { type: "addLocation", id, createdAt: "t", location });

  it("is saved, edited, and cleared for warehouses and clinics", () => {
    let s = add(INITIAL_STATE, "c", newSite("clinic", { from: 6, until: 14 }));
    expect(s.locations[0]?.gridPower).toEqual({ from: 6, until: 14 });
    s = reducer(s, { type: "updateLocation", id: "c", gridPower: { from: 10, until: 18 } });
    expect(s.locations[0]?.gridPower).toEqual({ from: 10, until: 18 });
    s = reducer(s, { type: "updateLocation", id: "c", gridPower: null });
    expect(s.locations[0]?.gridPower).toBeNull();
  });

  it("rejects bad windows and power hours on ports; a site that becomes a port loses them", () => {
    const s = add(INITIAL_STATE, "w", newSite("warehouse", { from: 6, until: 14 }));
    expect(reducer(s, { type: "updateLocation", id: "w", gridPower: { from: 9, until: 9 } })).toBe(
      s,
    );
    expect(add(INITIAL_STATE, "p", newSite("port", { from: 6, until: 14 }))).toBe(INITIAL_STATE);
    const port = reducer(s, { type: "updateLocation", id: "w", kind: "port" });
    expect(port.locations[0]?.gridPower).toBeNull();
    expect(
      reducer(port, { type: "updateLocation", id: "w", gridPower: { from: 1, until: 5 } }),
    ).toBe(port);
  });

  it("loads sites saved before grid power existed with a reliable grid", () => {
    const saved = add(INITIAL_STATE, "w", newSite("warehouse", { from: 6, until: 14 }));
    const { gridPower: _dropped, ...old } = saved.locations[0]!;
    expect(parseState({ ...saved, locations: [old] })?.locations[0]?.gridPower).toBeNull();
    expect(parseState(JSON.parse(JSON.stringify(saved)))?.locations[0]?.gridPower).toEqual({
      from: 6,
      until: 14,
    });
  });
});

describe("the Ghana sample network", () => {
  it("is ready to analyze, and the real optimizer puts solar where power cuts cost the most", async () => {
    const sample = createSampleNetwork();
    const n = unitsAffordable(sample.budget)!;
    expect(n).toBe(3);
    expect(analysisIssues(sample.locations, sample.connections, n)).toEqual([]);

    const network = { locations: sample.locations, connections: sample.connections };
    const allocation = await generateSolarAllocation(network, n);
    const name = (id: string) => sample.locations.find((l) => l.id === id)?.name;
    expect(allocation.selected.map(name)).toEqual([
      "Kumasi Medical Warehouse",
      "Komfo Anokye Clinic",
      "Tamale Clinic",
    ]);
    expect(allocation.optimized_weighted_hours).toBeLessThan(allocation.baseline_weighted_hours);

    // Each extra unit keeps helping, by less each time.
    const steps = await generateBudgetCurve(network, allocation);
    const hours = steps.map((s) => s.weighted_hours);
    expect(hours).toHaveLength(3);
    expect(hours[0]).toBeLessThan(allocation.baseline_weighted_hours);
    expect(hours[1]).toBeLessThan(hours[0]!);
    expect(hours[2]).toBeLessThan(hours[1]!);
  });
});
