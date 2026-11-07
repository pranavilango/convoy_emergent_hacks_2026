import { describe, expect, it } from "vitest";

import { INITIAL_STATE, parseState, reducer, typeNameError } from "@/lib/demo/reducer";
import type { DemoState, NewLocation } from "@/lib/demo/types";

const place = (typeId: string, overrides: Partial<NewLocation> = {}): NewLocation => ({
  name: "Bakery",
  address: "1 High St",
  placeId: "p1",
  lat: 51.5,
  lng: -0.12,
  typeId,
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

  it("adds directed connections and rejects duplicates and invalid endpoints", () => {
    const s = withLocations();
    const connected = reducer(s, { type: "addConnection", id: "ab", fromId: "a", toId: "b" });
    expect(connected.connections).toEqual([{ id: "ab", fromId: "a", toId: "b" }]);
    expect(
      reducer(connected, { type: "addConnection", id: "duplicate", fromId: "a", toId: "b" }),
    ).toBe(connected);
    expect(reducer(s, { type: "addConnection", id: "self", fromId: "a", toId: "a" })).toBe(s);
    expect(reducer(s, { type: "addConnection", id: "missing", fromId: "a", toId: "missing" })).toBe(
      s,
    );
    expect(
      reducer(connected, { type: "addConnection", id: "ba", fromId: "b", toId: "a" }).connections,
    ).toHaveLength(2);
  });

  it("removes connections when a location is removed", () => {
    let s = withLocations();
    s = reducer(s, { type: "addConnection", id: "ab", fromId: "a", toId: "b" });
    s = reducer(s, { type: "addConnection", id: "bc", fromId: "b", toId: "c" });
    s = reducer(s, { type: "removeLocation", id: "a" });
    expect(s.connections.map((connection) => connection.id)).toEqual(["bc"]);
  });

  it("removes connections whose locations are deleted with a type", () => {
    let s = withLocations();
    s = reducer(s, { type: "addConnection", id: "ac", fromId: "a", toId: "c" });
    s = reducer(s, { type: "removeType", id: "factory" });
    expect(s.connections).toEqual([]);
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
      { id: "valid", fromId: "b", toId: "c" },
    ];
    expect(parseState(raw)).toEqual({
      ...s,
      connections: [{ id: "valid", fromId: "a", toId: "b" }],
    });
  });

  it("returns null for things that aren't demo state", () => {
    expect(parseState(null)).toBeNull();
    expect(parseState({ types: "nope", locations: [] })).toBeNull();
  });
});
