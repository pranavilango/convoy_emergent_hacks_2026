import { describe, expect, it } from "vitest";

import { pointBeforeEnd, screenDistance, visualMidpoint } from "@/lib/demo/geometry";
import {
  connectionsOf,
  degrees,
  findConnection,
  incoming,
  otherEnd,
  outgoing,
} from "@/lib/demo/graph";
import {
  cloneHours,
  DEFAULT_HOURS,
  HOURS_PRESETS,
  hoursError,
  parseHours,
  summarizeHours,
} from "@/lib/demo/hours";
import { INITIAL_STATE, parseState, reducer, typeNameError } from "@/lib/demo/reducer";
import type { DemoState, NewLocation } from "@/lib/demo/types";

const place = (typeId: string, overrides: Partial<NewLocation> = {}): NewLocation => ({
  name: "Bakery",
  address: "1 High St",
  placeId: "p1",
  lat: 51.5,
  lng: -0.12,
  typeId,
  hours: cloneHours(DEFAULT_HOURS),
  ...overrides,
});

function withLocations(): DemoState {
  let s = INITIAL_STATE;
  s = reducer(s, { type: "addLocation", id: "a", createdAt: "t", location: place("factory") });
  s = reducer(s, { type: "addLocation", id: "b", createdAt: "t", location: place("factory") });
  s = reducer(s, { type: "addLocation", id: "c", createdAt: "t", location: place("warehouse") });
  return s;
}

describe("demo reducer", () => {
  it("starts with factory, warehouse, and retail store", () => {
    expect(INITIAL_STATE.types.map((t) => t.name)).toEqual([
      "Factory",
      "Warehouse",
      "Retail store",
    ]);
  });

  it("adds a type with a trimmed name and rejects duplicates case-insensitively", () => {
    const s = reducer(INITIAL_STATE, {
      type: "addType",
      id: "k",
      name: "  Dark   kitchen ",
      color: "#ff7aa8",
    });
    expect(s.types.at(-1)).toEqual({ id: "k", name: "Dark kitchen", color: "#ff7aa8" });
    expect(reducer(s, { type: "addType", id: "k2", name: "dark KITCHEN", color: "#ff7aa8" })).toBe(
      s,
    );
    expect(typeNameError(s.types, "Dark Kitchen")).toMatch(/already exists/);
    expect(typeNameError(s.types, "   ")).toMatch(/name/);
  });

  it("rejects colors outside the palette", () => {
    expect(reducer(INITIAL_STATE, { type: "addType", id: "x", name: "X", color: "red" })).toBe(
      INITIAL_STATE,
    );
  });

  it("renames a type without colliding with itself", () => {
    const s = reducer(INITIAL_STATE, { type: "updateType", id: "factory", name: "factory" });
    expect(s.types[0]?.name).toBe("factory");
    expect(reducer(s, { type: "updateType", id: "factory", name: "Warehouse" })).toBe(s);
  });

  it("only adds locations that reference an existing type and have coordinates", () => {
    const s = withLocations();
    expect(s.locations.map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(
      reducer(s, { type: "addLocation", id: "d", createdAt: "t", location: place("nope") }),
    ).toBe(s);
    expect(
      reducer(s, {
        type: "addLocation",
        id: "d",
        createdAt: "t",
        location: place("factory", { lat: NaN }),
      }),
    ).toBe(s);
  });

  it("falls back to the address when a location has no name", () => {
    const s = reducer(INITIAL_STATE, {
      type: "addLocation",
      id: "a",
      createdAt: "t",
      location: place("factory", { name: "  " }),
    });
    expect(s.locations[0]?.name).toBe("1 High St");
  });

  it("removing a type with reassignTo moves its locations", () => {
    const s = reducer(withLocations(), {
      type: "removeType",
      id: "factory",
      reassignTo: "warehouse",
    });
    expect(s.types.map((t) => t.id)).toEqual(["warehouse", "retail-store"]);
    expect(s.locations.map((l) => l.typeId)).toEqual(["warehouse", "warehouse", "warehouse"]);
  });

  it("removing a type without reassignTo deletes its locations", () => {
    const s = reducer(withLocations(), { type: "removeType", id: "factory" });
    expect(s.locations.map((l) => l.id)).toEqual(["c"]);
  });

  it("refuses to reassign to the type being removed or to an unknown type", () => {
    const s = withLocations();
    expect(reducer(s, { type: "removeType", id: "factory", reassignTo: "factory" })).toBe(s);
    expect(reducer(s, { type: "removeType", id: "factory", reassignTo: "ghost" })).toBe(s);
  });

  it("updates and removes locations", () => {
    let s = withLocations();
    s = reducer(s, {
      type: "updateLocation",
      id: "a",
      name: "Main kitchen",
      typeId: "retail-store",
    });
    expect(s.locations[0]).toMatchObject({ name: "Main kitchen", typeId: "retail-store" });
    s = reducer(s, { type: "removeLocation", id: "a" });
    expect(s.locations.map((l) => l.id)).toEqual(["b", "c"]);
  });

  const connect = (s: DemoState, id: string, fromId: string, toId: string) =>
    reducer(s, { type: "addConnection", id, fromId, toId });

  it("adds directed connections", () => {
    const s = connect(withLocations(), "cb", "c", "b");
    expect(s.connections).toEqual([{ id: "cb", fromId: "c", toId: "b" }]);
  });

  it("rejects an exact duplicate but allows the reverse direction", () => {
    const s = connect(withLocations(), "ab", "a", "b");
    expect(connect(s, "dup", "a", "b")).toBe(s);
    expect(connect(s, "ba", "b", "a").connections.map((c) => c.id)).toEqual(["ab", "ba"]);
  });

  it("rejects self-connections, unknown locations, and reused ids", () => {
    const s = withLocations();
    expect(connect(s, "self", "a", "a")).toBe(s);
    expect(connect(s, "missing", "a", "missing")).toBe(s);
    const once = connect(s, "x", "a", "b");
    expect(connect(once, "x", "b", "c")).toBe(once);
  });

  it("removes connections", () => {
    let s = connect(withLocations(), "ab", "a", "b");
    s = reducer(s, { type: "removeConnection", id: "ab" });
    expect(s.connections).toEqual([]);
  });

  it("removes a location's incoming and outgoing connections with it", () => {
    let s = withLocations();
    s = connect(s, "ab", "a", "b");
    s = connect(s, "ca", "c", "a");
    s = connect(s, "bc", "b", "c");
    s = reducer(s, { type: "removeLocation", id: "a" });
    expect(s.connections.map((c) => c.id)).toEqual(["bc"]);
  });

  it("removes connections whose locations are deleted with a type", () => {
    let s = connect(withLocations(), "ac", "a", "c");
    s = reducer(s, { type: "removeType", id: "factory" });
    expect(s.connections).toEqual([]);
  });

  it("keeps connections when a type's locations are moved to another type", () => {
    let s = connect(withLocations(), "ac", "a", "c");
    s = reducer(s, { type: "removeType", id: "factory", reassignTo: "retail-store" });
    expect(s.connections).toEqual([{ id: "ac", fromId: "a", toId: "c" }]);
  });
});

describe("working hours in the reducer", () => {
  it("stores a copy of the hours given when adding a location", () => {
    const hours = cloneHours(HOURS_PRESETS[2].hours);
    const s = reducer(INITIAL_STATE, {
      type: "addLocation",
      id: "a",
      createdAt: "t",
      location: place("factory", { hours }),
    });
    hours.mon = [];
    expect(s.locations[0]?.hours?.mon).toEqual([{ open: 0, close: 1440 }]);
  });

  it("refuses to add or update a location with invalid hours", () => {
    const bad = cloneHours(DEFAULT_HOURS);
    bad.tue = [{ open: 600, close: 600 }];
    expect(
      reducer(INITIAL_STATE, {
        type: "addLocation",
        id: "a",
        createdAt: "t",
        location: place("factory", { hours: bad }),
      }),
    ).toBe(INITIAL_STATE);
    const s = withLocations();
    expect(reducer(s, { type: "updateLocation", id: "a", hours: bad })).toBe(s);
  });

  it("updates hours", () => {
    const s = reducer(withLocations(), {
      type: "updateLocation",
      id: "a",
      hours: HOURS_PRESETS[1].hours,
    });
    expect(s.locations[0]?.hours?.sun).toEqual([{ open: 540, close: 1020 }]);
  });
});

describe("hours helpers", () => {
  it("summarises consecutive identical days", () => {
    expect(summarizeHours(DEFAULT_HOURS)).toEqual(["Mon–Fri 09:00–17:00", "Sat–Sun Closed"]);
    expect(summarizeHours(HOURS_PRESETS[2].hours)).toEqual(["Every day 24 hours"]);
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
    { id: "ab", fromId: "a", toId: "b" },
    { id: "bc", fromId: "b", toId: "c" },
    { id: "cb", fromId: "c", toId: "b" },
  ];

  it("finds connections by direction", () => {
    expect(findConnection(connections, "a", "b")?.id).toBe("ab");
    expect(findConnection(connections, "b", "a")).toBeUndefined();
  });

  it("lists outgoing, incoming, and total degree", () => {
    expect(outgoing(connections, "b").map((c) => c.id)).toEqual(["bc"]);
    expect(incoming(connections, "b").map((c) => c.id)).toEqual(["ab", "cb"]);
    expect(connectionsOf(connections, "b").map((c) => otherEnd(c, "b"))).toEqual(["a", "c", "c"]);
    expect(Object.fromEntries(degrees(connections))).toEqual({ a: 1, b: 3, c: 2 });
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
    const s = withLocations();
    expect(parseState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it("loads older saved state without connections", () => {
    const s = withLocations();
    const { connections: _connections, ...oldState } = s;
    expect(parseState(oldState)).toEqual(s);
  });

  it("drops malformed records but keeps the rest", () => {
    const s = withLocations();
    const raw = JSON.parse(JSON.stringify(s));
    raw.types.push({ id: "bad", name: "Bad", color: "not-a-color" });
    raw.locations.push({ ...raw.locations[0], id: "orphan", typeId: "missing" });
    raw.locations.push({ ...raw.locations[0], id: "far", lat: 200 });
    raw.locations.push(raw.locations[0]); // duplicate id
    raw.connections = [
      { id: "valid", fromId: "a", toId: "b" },
      { id: "self", fromId: "a", toId: "a" },
      { id: "orphan", fromId: "a", toId: "missing" },
      { id: "valid", fromId: "b", toId: "c" }, // duplicate id
      { id: "again", fromId: "a", toId: "b" }, // same direction as "valid"
    ];
    expect(parseState(raw)).toEqual({
      ...s,
      connections: [{ id: "valid", fromId: "a", toId: "b" }],
    });
  });

  it("keeps both directions of a pair", () => {
    const raw = JSON.parse(JSON.stringify(withLocations()));
    raw.connections = [
      { id: "ab", fromId: "a", toId: "b" },
      { id: "ba", fromId: "b", toId: "a" },
    ];
    expect(parseState(raw)?.connections.map((c) => c.id)).toEqual(["ab", "ba"]);
  });

  it("reads the short-lived undirected { aId, bId } format as aId → bId", () => {
    const raw = JSON.parse(JSON.stringify(withLocations()));
    raw.connections = [{ id: "x", aId: "b", bId: "c" }];
    expect(parseState(raw)?.connections).toEqual([{ id: "x", fromId: "b", toId: "c" }]);
  });

  it("loads locations saved before working hours existed with hours not set", () => {
    const raw = JSON.parse(JSON.stringify(withLocations()));
    delete raw.locations[0].hours;
    raw.locations[1].hours = { mon: "garbage" };
    const parsed = parseState(raw)!;
    expect(parsed.locations.map((l) => l.hours === null)).toEqual([true, true, false]);
  });

  it("returns null for things that aren't demo state", () => {
    expect(parseState(null)).toBeNull();
    expect(parseState({ types: "nope", locations: [] })).toBeNull();
  });
});
