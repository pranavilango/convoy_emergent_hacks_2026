import { describe, expect, it } from "vitest";

import { runEngine } from "@/lib/solar-allocation/engine";

// The same tiny network as the engine's own examples: depot → hub → clinic.
const graph = {
  nodes: [
    { id: "depot", kind: "source", latitude: -1.29, longitude: 36.82 },
    {
      id: "hub",
      kind: "pass_through",
      latitude: -0.3,
      longitude: 36.08,
      open_from: 8,
      open_until: 16,
    },
    {
      id: "clinic",
      kind: "destination",
      latitude: 0.28,
      longitude: 34.75,
      open_from: 10,
      open_until: 14,
      priority: 40,
    },
  ],
  edges: [
    { from: "depot", to: "hub" },
    { from: "hub", to: "clinic" },
  ],
};

describe("built-in Rust engine (WebAssembly)", () => {
  it("answers like the medroute HTTP API", () => {
    const result = runEngine(JSON.stringify(graph), 1);
    expect(result).toMatchObject({ ok: { n: 1, solver: "exact" } });
    if (!("ok" in result)) throw new Error("expected a result");
    const ok = result.ok as {
      selected: string[];
      baseline_weighted_hours: number;
      optimized_weighted_hours: number;
    };
    expect(ok.selected).toHaveLength(1);
    expect(ok.optimized_weighted_hours).toBeLessThan(ok.baseline_weighted_hours);
  });

  it("is deterministic across calls", () => {
    expect(runEngine(JSON.stringify(graph), 2)).toEqual(runEngine(JSON.stringify(graph), 2));
  });

  it("returns the HTTP API's error statuses", () => {
    expect(runEngine("{not json", 1)).toMatchObject({ status: 400 });
    expect(runEngine(JSON.stringify({ nodes: [], edges: [] }), 1)).toMatchObject({ status: 422 });
    expect(runEngine(JSON.stringify(graph), 0)).toMatchObject({ status: 422 });
  });
});
