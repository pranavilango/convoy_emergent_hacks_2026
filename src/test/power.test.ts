import { describe, expect, it } from "vitest";

import { unitsAffordable } from "@/lib/demo/budget";
import { ALWAYS_OPEN, cloneHours, DEFAULT_HOURS } from "@/lib/demo/hours";
import { formatPower, isHourWindow, receivingWindows, staffedWindow } from "@/lib/demo/power";
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

describe("power problems before Analyze", () => {
  it("names a site that never has power while it's staffed", () => {
    const sites = [
      site("p", "port"),
      site("w", "warehouse"),
      site("c", "clinic", { gridPower: { from: 18, until: 24 } }),
    ];
    expect(analysisIssues(sites, links, 1)).toEqual([
      "C never has power while it's staffed (power 18:00–24:00, staffed 09:00–17:00). Widen its power or working hours.",
    ]);
  });

  it("names a site that's staffed and powered for under two hours", () => {
    const sites = [
      site("p", "port"),
      site("w", "warehouse"),
      site("c", "clinic", { gridPower: { from: 16, until: 20 } }),
    ];
    expect(analysisIssues(sites, links, 1)).toEqual([
      "C is staffed and powered for only 1 hour a day (16:00–17:00). The optimizer needs at least 2, so widen its power or working hours.",
    ]);
  });

  it("asks for power hours when no site has a power cut, since solar would change nothing", () => {
    const sites = [
      site("p", "port"),
      site("w", "warehouse", { gridPower: null }),
      site("c", "clinic", { gridPower: null }),
    ];
    expect(analysisIssues(sites, links, 1)).toEqual([
      "No site loses power during its working hours, so solar wouldn't shorten any waits. Set the grid power hours of sites with power cuts.",
    ]);
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
