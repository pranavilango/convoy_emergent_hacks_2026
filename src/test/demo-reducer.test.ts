import { describe, expect, it } from "vitest";

import {
  amountError,
  EMPTY_BUDGET,
  formatMoney,
  parseAmount,
  unitsAffordable,
} from "@/lib/demo/budget";
import {
  distanceKm,
  formatDistance,
  letterSize,
  pointBeforeEnd,
  screenDistance,
  squareSize,
  visualMidpoint,
} from "@/lib/demo/geometry";
import {
  connectionsOf,
  degrees,
  findConnection,
  incoming,
  otherEnd,
  outgoing,
} from "@/lib/demo/graph";
import {
  ALWAYS_OPEN,
  cloneHours,
  DEFAULT_HOURS,
  HOURS_PRESETS,
  hoursError,
  parseHours,
  summarizeHours,
} from "@/lib/demo/hours";
import { canSupply, kindLabel, LOCATION_KINDS, type LocationKind } from "@/lib/demo/kinds";
import {
  formatPopulation,
  parsePopulation,
  peopleLabel,
  populationError,
} from "@/lib/demo/population";
import { connectionsBrokenByKind, INITIAL_STATE, parseState, reducer } from "@/lib/demo/reducer";
import type { DemoState, NewLocation } from "@/lib/demo/types";

const site = (kind: LocationKind, overrides: Partial<NewLocation> = {}): NewLocation => ({
  name: "Site",
  address: "1 Harbour Rd",
  placeId: "p1",
  lat: -6.8,
  lng: 39.28,
  kind,
  portMode: kind === "port" ? "sea" : null,
  hours: cloneHours(DEFAULT_HOURS),
  gridPower: null,
  population: kind === "clinic" ? 1200 : null,
  ...overrides,
});

const add = (s: DemoState, id: string, location: NewLocation) =>
  reducer(s, { type: "addLocation", id, createdAt: "t", location });

const connect = (s: DemoState, id: string, fromId: string, toId: string) =>
  reducer(s, { type: "addConnection", id, fromId, toId });

/** Port p, warehouses w1 and w2, clinic c. */
function network(): DemoState {
  let s = INITIAL_STATE;
  s = add(s, "p", site("port"));
  s = add(s, "w1", site("warehouse"));
  s = add(s, "w2", site("warehouse"));
  s = add(s, "c", site("clinic"));
  return s;
}

/** p → w1 → c. */
function chain(): DemoState {
  return connect(connect(network(), "pw", "p", "w1"), "wc", "w1", "c");
}

describe("supply chain rule", () => {
  it("only allows port → warehouse and warehouse → clinic", () => {
    const allowed = LOCATION_KINDS.flatMap((from) =>
      LOCATION_KINDS.filter((to) => canSupply(from, to)).map((to) => `${from}→${to}`),
    );
    expect(allowed).toEqual(["port→warehouse", "warehouse→clinic"]);
  });

  it("labels ports with their mode", () => {
    expect(kindLabel({ kind: "port", portMode: "air" })).toBe("Port · Air");
    expect(kindLabel({ kind: "clinic", portMode: null })).toBe("Clinic");
  });
});

describe("adding locations", () => {
  it("adds every kind", () => {
    expect(network().locations.map((l) => [l.id, l.kind])).toEqual([
      ["p", "port"],
      ["w1", "warehouse"],
      ["w2", "warehouse"],
      ["c", "clinic"],
    ]);
  });

  it("keeps ports open 24/7 whatever hours are passed, and requires air or sea", () => {
    const s = add(INITIAL_STATE, "p", site("port", { portMode: "air", hours: DEFAULT_HOURS }));
    expect(s.locations[0]).toMatchObject({ portMode: "air", hours: ALWAYS_OPEN });
    expect(add(INITIAL_STATE, "p", site("port", { portMode: null }))).toBe(INITIAL_STATE);
  });

  it("drops a port mode given to a non-port", () => {
    const s = add(INITIAL_STATE, "w", site("warehouse", { portMode: "air" }));
    expect(s.locations[0]?.portMode).toBeNull();
  });

  it("stores a copy of the hours, and refuses invalid ones", () => {
    const hours = cloneHours(HOURS_PRESETS[1].hours);
    const s = add(INITIAL_STATE, "c", site("clinic", { hours }));
    hours.mon = [];
    expect(s.locations[0]?.hours.mon).toEqual([{ open: 540, close: 1020 }]);

    const bad = cloneHours(DEFAULT_HOURS);
    bad.tue = [{ open: 600, close: 600 }];
    expect(add(INITIAL_STATE, "c", site("clinic", { hours: bad }))).toBe(INITIAL_STATE);
  });

  it("refuses unknown kinds, missing coordinates, and reused ids", () => {
    const s = network();
    expect(add(s, "x", site("factory" as LocationKind))).toBe(s);
    expect(add(s, "x", site("clinic", { lat: NaN }))).toBe(s);
    expect(add(s, "p", site("clinic"))).toBe(s);
  });

  it("falls back to the address when a location has no name", () => {
    const s = add(INITIAL_STATE, "c", site("clinic", { name: "  " }));
    expect(s.locations[0]?.name).toBe("1 Harbour Rd");
  });
});

describe("clinic population", () => {
  it("requires a whole, positive population for new clinics", () => {
    expect(add(INITIAL_STATE, "c", site("clinic")).locations[0]?.population).toBe(1200);
    for (const population of [null, 0, -5, 1.5, NaN, 100_000_001]) {
      expect(add(INITIAL_STATE, "c", site("clinic", { population }))).toBe(INITIAL_STATE);
    }
  });

  it("drops a population given to a port or warehouse", () => {
    const s = add(INITIAL_STATE, "w", site("warehouse", { population: 500 }));
    expect(s.locations[0]?.population).toBeNull();
  });

  it("updates a clinic's population, and refuses it for other kinds or bad values", () => {
    const s = network();
    expect(
      reducer(s, { type: "updateLocation", id: "c", population: 45_000 }).locations[3]?.population,
    ).toBe(45_000);
    expect(reducer(s, { type: "updateLocation", id: "w1", population: 10 })).toBe(s);
    expect(reducer(s, { type: "updateLocation", id: "c", population: 0 })).toBe(s);
  });

  it("clears the population when a clinic changes kind, and starts unset when one becomes a clinic", () => {
    let s = reducer(network(), { type: "updateLocation", id: "c", kind: "warehouse" });
    expect(s.locations[3]?.population).toBeNull();
    s = reducer(s, { type: "updateLocation", id: "w1", kind: "clinic" });
    expect(s.locations[1]?.population).toBeNull();
    s = reducer(s, { type: "updateLocation", id: "w2", kind: "clinic", population: 800 });
    expect(s.locations[2]?.population).toBe(800);
  });

  it("reads typed populations with separators and explains bad ones", () => {
    expect(parsePopulation("12,400")).toBe(12_400);
    expect(parsePopulation(" 12 400 ")).toBe(12_400);
    for (const bad of ["", "abc", "0", "1.5", "-3", "100000001"]) {
      expect(parsePopulation(bad)).toBeNull();
      expect(populationError(bad)).not.toBeNull();
    }
    expect(populationError("")).toMatch(/how many people/);
    expect(populationError("12k")).toMatch(/whole number/);
    expect(populationError("12,400")).toBeNull();
    expect(formatPopulation(1_234_567)).toBe("1,234,567");
    expect(peopleLabel(1)).toBe("1 person");
    expect(peopleLabel(12_400)).toBe("12,400 people");
  });
});

describe("updating locations", () => {
  it("renames and removes locations", () => {
    let s = reducer(network(), { type: "updateLocation", id: "c", name: "  St  Luke's " });
    expect(s.locations[3]?.name).toBe("St Luke's");
    s = reducer(s, { type: "removeLocation", id: "c" });
    expect(s.locations.map((l) => l.id)).toEqual(["p", "w1", "w2"]);
  });

  it("updates hours for warehouses and clinics but not ports", () => {
    const s = network();
    const next = reducer(s, { type: "updateLocation", id: "w1", hours: HOURS_PRESETS[1].hours });
    expect(next.locations[1]?.hours.sun).toEqual([{ open: 540, close: 1020 }]);
    expect(reducer(s, { type: "updateLocation", id: "p", hours: DEFAULT_HOURS })).toBe(s);
    const bad = cloneHours(DEFAULT_HOURS);
    bad.wed = [{ open: 900, close: 900 }];
    expect(reducer(s, { type: "updateLocation", id: "w1", hours: bad })).toBe(s);
  });

  it("switches a port between sea and air, and refuses a mode for other kinds", () => {
    const s = network();
    expect(
      reducer(s, { type: "updateLocation", id: "p", portMode: "air" }).locations[0]?.portMode,
    ).toBe("air");
    expect(reducer(s, { type: "updateLocation", id: "c", portMode: "air" })).toBe(s);
  });

  it("turning a site into a port makes it 24/7 sea by default", () => {
    const s = reducer(network(), { type: "updateLocation", id: "c", kind: "port" });
    expect(s.locations[3]).toMatchObject({ kind: "port", portMode: "sea", hours: ALWAYS_OPEN });
  });

  it("turning a port into another kind gives it default hours to edit", () => {
    const s = reducer(network(), { type: "updateLocation", id: "p", kind: "clinic" });
    expect(s.locations[0]).toMatchObject({ kind: "clinic", portMode: null, hours: DEFAULT_HOURS });
  });

  it("keeps a clinic's hours when it becomes a warehouse", () => {
    let s = reducer(network(), {
      type: "updateLocation",
      id: "c",
      hours: HOURS_PRESETS[1].hours,
    });
    s = reducer(s, { type: "updateLocation", id: "c", kind: "warehouse" });
    expect(s.locations[3]?.hours).toEqual(HOURS_PRESETS[1].hours);
  });

  it("removes connections the new kind can't have", () => {
    const s = chain();
    expect(connectionsBrokenByKind(s, "w1", "clinic").map((c) => c.id)).toEqual(["pw", "wc"]);
    expect(connectionsBrokenByKind(s, "c", "warehouse").map((c) => c.id)).toEqual(["wc"]);
    expect(connectionsBrokenByKind(s, "w1", "warehouse")).toEqual([]);

    const next = reducer(s, { type: "updateLocation", id: "c", kind: "warehouse" });
    expect(next.connections.map((c) => c.id)).toEqual(["pw"]);
    // Renaming without changing kind keeps every connection.
    expect(reducer(s, { type: "updateLocation", id: "w1", name: "Hub" }).connections).toBe(
      s.connections,
    );
  });
});

describe("connections", () => {
  it("adds port → warehouse and warehouse → clinic", () => {
    expect(chain().connections).toEqual([
      { id: "pw", fromId: "p", toId: "w1" },
      { id: "wc", fromId: "w1", toId: "c" },
    ]);
  });

  it("refuses links against the flow or that skip a step", () => {
    const s = network();
    for (const [from, to] of [
      ["w1", "p"], // backwards
      ["c", "w1"], // backwards
      ["p", "c"], // skips the warehouse
      ["w1", "w2"], // warehouse to warehouse
      ["c", "c"], // self
    ] as const) {
      expect(connect(s, "x", from, to)).toBe(s);
    }
  });

  it("refuses duplicates, unknown locations, and reused ids", () => {
    const s = chain();
    expect(connect(s, "dup", "p", "w1")).toBe(s);
    expect(connect(s, "x", "p", "missing")).toBe(s);
    expect(connect(s, "pw", "p", "w2")).toBe(s);
  });

  it("removes connections, and a location's connections with it", () => {
    let s = chain();
    s = reducer(s, { type: "removeConnection", id: "pw" });
    expect(s.connections.map((c) => c.id)).toEqual(["wc"]);
    s = connect(s, "pw2", "p", "w2");
    s = reducer(s, { type: "removeLocation", id: "w1" });
    expect(s.connections.map((c) => c.id)).toEqual(["pw2"]);
  });
});

describe("budget", () => {
  const setBudget = (s: DemoState, unitCost?: number | null, total?: number | null) =>
    reducer(s, {
      type: "setBudget",
      ...(unitCost !== undefined ? { unitCost } : {}),
      ...(total !== undefined ? { total } : {}),
    });

  it("starts empty, and sets, keeps, and clears each amount independently", () => {
    expect(INITIAL_STATE.budget).toEqual(EMPTY_BUDGET);
    let s = setBudget(INITIAL_STATE, 1200);
    expect(s.budget).toEqual({ unitCost: 1200, total: null });
    s = setBudget(s, undefined, 50_000.5);
    expect(s.budget).toEqual({ unitCost: 1200, total: 50_000.5 });
    expect(setBudget(s, 1200)).toBe(s);
    expect(setBudget(s, null).budget).toEqual({ unitCost: null, total: 50_000.5 });
  });

  it("refuses zero, negative, fractional-cent, and non-finite amounts", () => {
    for (const bad of [0, -5, 1.234, NaN, Infinity, 2e12]) {
      expect(setBudget(INITIAL_STATE, bad)).toBe(INITIAL_STATE);
      expect(setBudget(INITIAL_STATE, undefined, bad)).toBe(INITIAL_STATE);
    }
  });

  it("is kept when locations and connections change", () => {
    let s = setBudget(chain(), 1200, 10_000);
    s = reducer(s, { type: "updateLocation", id: "w1", kind: "clinic" });
    s = reducer(s, { type: "removeLocation", id: "p" });
    expect(s.budget).toEqual({ unitCost: 1200, total: 10_000 });
  });

  it("reads typed amounts and explains bad ones", () => {
    expect(parseAmount("1,250")).toBe(1250);
    expect(parseAmount(" $1,250.50 ")).toBe(1250.5);
    for (const bad of ["", "abc", "0", "-3", "1.234", "12k", "1."]) {
      expect(parseAmount(bad)).toBeNull();
    }
    expect(amountError("")).toBeNull();
    expect(amountError("12k")).toMatch(/number in dollars/);
    expect(amountError("1.234")).toMatch(/two decimal places/);
    expect(amountError("0")).toMatch(/more than \$0/);
    expect(formatMoney(1250)).toBe("$1,250");
    expect(formatMoney(1250.5)).toBe("$1,250.50");
  });

  it("counts whole units the budget covers, in cents", () => {
    expect(unitsAffordable({ unitCost: 1200, total: 10_000 })).toBe(8);
    expect(unitsAffordable({ unitCost: 0.1, total: 0.3 })).toBe(3);
    expect(unitsAffordable({ unitCost: 500, total: 499.99 })).toBe(0);
    expect(unitsAffordable({ unitCost: 500, total: null })).toBeNull();
  });
});

describe("hours helpers", () => {
  it("summarises consecutive identical days", () => {
    expect(summarizeHours(DEFAULT_HOURS)).toEqual(["Mon–Fri 09:00–17:00", "Sat–Sun Closed"]);
    expect(summarizeHours(ALWAYS_OPEN)).toEqual(["Every day 24 hours"]);
    const split = cloneHours(DEFAULT_HOURS);
    split.wed = [{ open: 1320, close: 120 }];
    expect(summarizeHours(split)).toEqual([
      "Mon–Tue 09:00–17:00",
      "Wed 22:00–02:00 (+1)",
      "Thu–Fri 09:00–17:00",
      "Sat–Sun Closed",
    ]);
  });

  it("accepts overnight ranges and rejects empty, out-of-range, or overlapping ones", () => {
    const h = cloneHours(DEFAULT_HOURS);
    h.fri = [{ open: 1320, close: 120 }];
    expect(hoursError(h)).toBeNull();
    h.fri = [{ open: 540, close: 540 }];
    expect(hoursError(h)).toMatch(/^Fri:/);
    h.fri = [{ open: 540, close: 1500 }];
    expect(hoursError(h)).toMatch(/out of range/);
    h.fri = [
      { open: 540, close: 720 },
      { open: 700, close: 900 },
    ];
    expect(hoursError(h)).toMatch(/overlap/);
  });

  it("parses saved hours and rejects malformed ones", () => {
    expect(parseHours(JSON.parse(JSON.stringify(DEFAULT_HOURS)))).toEqual(DEFAULT_HOURS);
    expect(parseHours({ mon: [] })).toBeNull();
    expect(parseHours({ ...DEFAULT_HOURS, mon: [{ open: "9", close: 17 }] })).toBeNull();
  });
});

describe("graph helpers", () => {
  const connections = [
    { id: "pa", fromId: "p", toId: "a" },
    { id: "pb", fromId: "p", toId: "b" },
    { id: "ac", fromId: "a", toId: "c" },
  ];

  it("finds connections by direction", () => {
    expect(findConnection(connections, "p", "a")?.id).toBe("pa");
    expect(findConnection(connections, "a", "p")).toBeUndefined();
  });

  it("lists outgoing, incoming, and total degree", () => {
    expect(outgoing(connections, "a").map((c) => c.id)).toEqual(["ac"]);
    expect(incoming(connections, "a").map((c) => c.id)).toEqual(["pa"]);
    expect(connectionsOf(connections, "a").map((c) => otherEnd(c, "a"))).toEqual(["p", "c"]);
    expect(Object.fromEntries(degrees(connections))).toEqual({ p: 2, a: 2, b: 1, c: 1 });
  });
});

describe("distance", () => {
  it("measures the straight line between two places", () => {
    const london = { lat: 51.5074, lng: -0.1278 };
    const paris = { lat: 48.8566, lng: 2.3522 };
    expect(distanceKm(london, paris)).toBeCloseTo(343.56, 1);
    expect(distanceKm(paris, london)).toBeCloseTo(distanceKm(london, paris), 9);
    expect(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111.2, 1);
    expect(distanceKm(london, london)).toBe(0);
  });

  it("shows one decimal under 10 km and whole km above", () => {
    expect(formatDistance(0.04)).toBe("<0.1 km");
    expect(formatDistance(0.06)).toBe("0.1 km");
    expect(formatDistance(3.26)).toBe("3.3 km");
    expect(formatDistance(42.4)).toBe("42 km");
    expect(formatDistance(1204.6)).toBe("1,205 km");
  });
});

describe("marker scale", () => {
  it("shrinks squares from 24px up close to 12px zoomed out", () => {
    expect(squareSize(16)).toBe(24);
    expect(squareSize(12)).toBe(24);
    expect(squareSize(8)).toBe(18);
    expect(squareSize(4)).toBe(12);
    expect(squareSize(1)).toBe(12);
    // Never grows as you zoom out.
    for (let z = 1; z < 16; z += 0.25)
      expect(squareSize(z)).toBeLessThanOrEqual(squareSize(z + 0.25));
  });

  it("shrinks the letter with the square, then drops it below 8px", () => {
    expect(letterSize(24)).toBe(13);
    expect(letterSize(18)).toBe(10);
    expect(letterSize(15)).toBe(8);
    expect(letterSize(14)).toBe(8);
    expect(letterSize(13.5)).toBe(0);
    expect(letterSize(12)).toBe(0);
  });
});

describe("line geometry", () => {
  const a = { lat: 51.5, lng: -0.12 };
  const b = { lat: 51.52, lng: -0.08 };

  it("stops the line a fixed number of screen pixels before the destination", () => {
    for (const zoom of [10, 14, 17]) {
      const tip = pointBeforeEnd(a, b, zoom, 13)!;
      expect(screenDistance(tip, b, zoom)).toBeCloseTo(13, 6);
      expect(screenDistance(a, tip, zoom) + 13).toBeCloseTo(screenDistance(a, b, zoom), 6);
    }
  });

  it("returns null when the points are closer than the trim on screen", () => {
    expect(pointBeforeEnd(a, b, 2, 13)).toBeNull();
  });

  it("midpoint is equidistant on screen", () => {
    const m = visualMidpoint({ lat: 0, lng: 0 }, { lat: 60, lng: 10 });
    expect(screenDistance({ lat: 0, lng: 0 }, m, 5)).toBeCloseTo(
      screenDistance(m, { lat: 60, lng: 10 }, 5),
      6,
    );
  });
});

describe("parseState", () => {
  it("round-trips valid state", () => {
    const s = chain();
    expect(parseState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it("drops malformed records but keeps the rest", () => {
    const s = chain();
    const raw = JSON.parse(JSON.stringify(s));
    const [port, , , clinic] = raw.locations;
    raw.locations.push({ ...clinic, id: "factory", kind: "factory" });
    raw.locations.push({ ...port, id: "modeless", portMode: null });
    raw.locations.push({ ...clinic, id: "no-hours", hours: { mon: "9-5" } });
    raw.locations.push({ ...clinic, id: "far", lat: 200 });
    raw.locations.push(clinic); // duplicate id
    raw.connections.push(
      { id: "backwards", fromId: "c", toId: "w1" },
      { id: "skip", fromId: "p", toId: "c" },
      { id: "orphan", fromId: "p", toId: "missing" },
      { id: "pw", fromId: "p", toId: "w2" }, // duplicate id
      { id: "again", fromId: "p", toId: "w1" }, // same link as "pw"
    );
    expect(parseState(raw)).toEqual(s);
  });

  it("loads a clinic without a valid population as not set, and ignores one on other kinds", () => {
    const raw = JSON.parse(JSON.stringify(network()));
    delete raw.locations[3].population;
    raw.locations[1].population = 900;
    const parsed = parseState(raw)!;
    expect(parsed.locations.map((l) => l.population)).toEqual([null, null, null, null]);
    raw.locations[3].population = "lots";
    expect(parseState(raw)?.locations[3]?.population).toBeNull();
  });

  it("loads a missing or malformed budget as not set", () => {
    const raw = JSON.parse(JSON.stringify(network()));
    delete raw.budget;
    expect(parseState(raw)?.budget).toEqual(EMPTY_BUDGET);
    raw.budget = { unitCost: 1200, total: "lots" };
    expect(parseState(raw)?.budget).toEqual({ unitCost: 1200, total: null });
  });

  it("always loads ports as open 24/7", () => {
    const raw = JSON.parse(JSON.stringify(network()));
    raw.locations[0].hours = DEFAULT_HOURS;
    expect(parseState(raw)?.locations[0]?.hours).toEqual(ALWAYS_OPEN);
  });

  it("returns null for things that aren't demo state", () => {
    expect(parseState(null)).toBeNull();
    expect(parseState({ locations: "nope" })).toBeNull();
  });
});
