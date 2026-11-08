import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/solar-allocation/route";
import {
  analyzeSolarAllocation,
  type SolarAllocation,
  type SolarAllocationNetwork,
} from "@/lib/solar-allocation/analyze";
import { __resetAnalysisGuard, PER_CLIENT, takeAnalysis } from "@/lib/solar-allocation/guard";

const savedEnv = {
  apiKey: process.env["GEMINI_API_KEY"],
  model: process.env["GEMINI_MODEL"],
  backend: process.env["MEDROUTE_API_URL"],
};

beforeEach(() => __resetAnalysisGuard());

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv("GEMINI_API_KEY", savedEnv.apiKey);
  restoreEnv("GEMINI_MODEL", savedEnv.model);
  restoreEnv("MEDROUTE_API_URL", savedEnv.backend);
});

const allocation: SolarAllocation = {
  selected: ["warehouse-1", "clinic-1"],
  n: 2,
  solver: "exact",
  baseline_weighted_hours: 21.64,
  optimized_weighted_hours: 11.54,
};

const dailyHours = {
  mon: [{ open: 540, close: 1020 }],
  tue: [{ open: 540, close: 1020 }],
  wed: [{ open: 540, close: 1020 }],
  thu: [{ open: 540, close: 1020 }],
  fri: [{ open: 540, close: 1020 }],
  sat: [],
  sun: [],
};

const network: SolarAllocationNetwork = {
  locations: [
    { id: "port-1", name: "Dar Port", kind: "port", lat: -6.8, lng: 39.3, hours: dailyHours },
    {
      id: "warehouse-1",
      name: "Central Store",
      kind: "warehouse",
      lat: -3.4,
      lng: 36.7,
      population: null,
      hours: dailyHours,
      gridPower: { from: 6, until: 14 },
    },
    {
      id: "clinic-1",
      name: "Clinic A",
      kind: "clinic",
      lat: -2.5,
      lng: 32.9,
      population: 12_400,
      hours: dailyHours,
      gridPower: { from: 12, until: 20 },
    },
  ],
  connections: [
    { fromId: "port-1", toId: "warehouse-1" },
    { fromId: "warehouse-1", toId: "clinic-1" },
  ],
};

describe("solar allocation analysis", () => {
  it("sends the backend JSON result to Gemini", async () => {
    process.env["GEMINI_API_KEY"] = "test-api-key";
    process.env["GEMINI_MODEL"] = "gemini-test-model";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Prioritize the clinic allocation." }] } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(analyzeSolarAllocation(network, allocation)).resolves.toBe(
      "Prioritize the clinic allocation.",
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/gemini-test-model:generateContent");
    expect(new Headers(options.headers).get("x-goog-api-key")).toBe("test-api-key");
    const prompt = String(options.body);
    // Plain-language facts, by name: hours, people served, supply links with distances.
    expect(prompt).toContain("Clinic A");
    expect(prompt).toContain("12400");
    expect(prompt).toContain("Mon–Fri 09:00–17:00");
    // When each site can take in medicines: staffed and powered, then with solar.
    expect(prompt).toMatch(/gridPower\W+06:00–14:00 \(8 h a day\)/);
    expect(prompt).toMatch(/takesInMedicinesToday\W+09:00–14:00/);
    expect(prompt).toMatch(/takesInMedicinesWithSolar\W+09:00–17:00/);
    expect(prompt).toContain("21.6"); // weighted hours before, rounded
    expect(prompt).toMatch(/Central Store[^}]*km/);
    // Guardrails: explain, don't re-decide; no ids or method talk.
    expect(prompt).toContain("at most 12 words per bullet");
    expect(prompt).toContain("do not bold the label before the colon");
    expect(prompt).toContain(
      "Do not suggest other allocations or compare with any except the obvious alternative given",
    );
    // Plain terms only: no "weighted" or "people-hours" in what Gemini writes.
    expect(prompt).toContain("never say 'weighted', 'population-weighted', 'people-hours'");
    expect(prompt).toMatch(/averagePortToClinicHours\W+withoutSolar\W+21\.6\W+withPlan\W+11\.5/);
    expect(prompt).toContain("Never mention ids, algorithms, solvers");
    // Field names stay out of the explanation ("weightedDeliveryHours changed from …").
    expect(prompt).toContain("Never write field names or camelCase keys from the facts");
    expect(prompt).not.toContain("warehouse-1");
  });

  it("returns the Rust allocation with Gemini's explanation", async () => {
    process.env["GEMINI_API_KEY"] = "test-api-key";
    process.env["MEDROUTE_API_URL"] = "http://medroute.test/";
    const oneUnit = { ...allocation, selected: ["clinic-1"], n: 1, optimized_weighted_hours: 15 };
    const fetchMock = vi.fn((url: string, _init?: RequestInit) =>
      Promise.resolve(
        url.includes("generativelanguage")
          ? new Response(
              JSON.stringify({
                candidates: [
                  { content: { parts: [{ text: "The selected sites reduce weighted waits." }] } },
                ],
              }),
              { status: 200 },
            )
          : new Response(JSON.stringify(url.includes("n=1&") ? oneUnit : allocation), {
              status: 200,
            }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/solar-allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network, n: 2 }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      allocation,
      // What each unit buys: the best single site, then the full allocation.
      steps: [
        { units: 1, selected: ["clinic-1"], weighted_hours: 15 },
        { units: 2, selected: ["warehouse-1", "clinic-1"], weighted_hours: 11.54 },
      ],
      analysis: "The selected sites reduce weighted waits.",
    });
    // n=2 (the answer), n=1 (the curve), then Gemini.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://medroute.test/api/analyze?n=2&strategy=auto");
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
    const uploaded = (options.body as FormData).get("file");
    expect(uploaded).toBeInstanceOf(Blob);
    const graph = JSON.parse(await (uploaded as Blob).text()) as {
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    };
    expect(graph.nodes[0]).toEqual({
      id: "port-1",
      latitude: -6.8,
      longitude: 39.3,
      kind: "source",
    });
    // Window today = staffed 09–17 ∩ powered 06–14 = 09–14; with solar = staffed. [a, b] = a:00
    // to (b+1):00.
    expect(graph.nodes[1]).toMatchObject({
      kind: "pass_through",
      open_from: 9,
      open_until: 13,
      solar_open_from: 9,
      solar_open_until: 16,
    });
    expect(graph.nodes[2]).toMatchObject({
      kind: "destination",
      open_from: 12,
      open_until: 16,
      solar_open_from: 9,
      solar_open_until: 16,
      priority: 12_400,
    });
    expect(graph.edges).toEqual([
      { from: "port-1", to: "warehouse-1" },
      { from: "warehouse-1", to: "clinic-1" },
    ]);
  });

  it("reports missing Gemini configuration instead of returning an unexplained allocation", async () => {
    delete process.env["GEMINI_API_KEY"];
    process.env["MEDROUTE_API_URL"] = "http://medroute.test/";
    // The optimizer answers for whatever unit count it's asked.
    const fetchMock = vi.fn((url: string) => {
      const n = Number(new URL(url).searchParams.get("n"));
      const selected = allocation.selected.slice(0, n);
      return Promise.resolve(
        new Response(JSON.stringify({ ...allocation, n, selected }), { status: 200 }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/solar-allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network, n: 2 }),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Gemini explanation is not configured on the server.",
    });
    // The optimizer ran; Gemini was never called.
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("generativelanguage"))).toBe(
      true,
    );
  });

  it("runs the built-in Rust engine (WebAssembly) when no service URL is set", async () => {
    delete process.env["MEDROUTE_API_URL"];
    process.env["GEMINI_API_KEY"] = "test-api-key";
    // Only Gemini may be called over the network: the optimizer runs in-process.
    const fetchMock = vi.fn((url: string) => {
      if (!url.includes("generativelanguage")) throw new Error(`Unexpected fetch: ${url}`);
      return Promise.resolve(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "Explained." }] } }] }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/solar-allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network, n: 2 }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.allocation).toMatchObject({ selected: ["warehouse-1", "clinic-1"], n: 2 });
    expect(body.allocation.optimized_weighted_hours).toBeLessThan(
      body.allocation.baseline_weighted_hours,
    );
    expect(body.steps.map((s: { units: number }) => s.units)).toEqual([1, 2]);
    expect(body.analysis).toBe("Explained.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports the built-in engine's validation errors by site name", async () => {
    delete process.env["MEDROUTE_API_URL"];
    vi.stubGlobal("fetch", vi.fn());
    const unlinked = { ...network, connections: [network.connections[0]!] };
    const response = await POST(
      new Request("http://localhost/api/solar-allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: unlinked, n: 1 }),
      }),
    );
    expect(response.status).toBe(422);
    const { error } = await response.json();
    expect(error).not.toContain("clinic-1");
    expect(error).toMatch(/Central Store|Clinic A/);
  });

  it("names sites instead of ids in the optimizer's errors", async () => {
    process.env["MEDROUTE_API_URL"] = "http://medroute.test/";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "destination `clinic-1` has no incoming edge" }), {
          status: 422,
        }),
      ),
    );
    const response = await POST(
      new Request("http://localhost/api/solar-allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network, n: 2 }),
      }),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "destination `Clinic A` has no incoming edge",
    });
  });

  it("rejects requests without a valid graph or solar-unit count", async () => {
    const response = await POST(
      new Request("http://localhost/api/solar-allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: { locations: [], connections: "invalid" }, n: 2 }),
      }),
    );
    expect(response.status).toBe(400);

    const missingUnits = await POST(
      new Request("http://localhost/api/solar-allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network, n: 0 }),
      }),
    );
    expect(missingUnits.status).toBe(400);
  });
});

describe("protecting the public Analyze route", () => {
  const geminiOnly = () =>
    vi.fn((url: string) => {
      if (!url.includes("generativelanguage")) throw new Error(`Unexpected fetch: ${url}`);
      return Promise.resolve(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "Explained." }] } }] }),
          { status: 200 },
        ),
      );
    });
  const analyze = (n: number, ip = "203.0.113.7") =>
    POST(
      new Request("http://localhost/api/solar-allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` },
        body: JSON.stringify({ network, n }),
      }),
    );

  it("answers a repeated analysis from cache, without calling Gemini again", async () => {
    delete process.env["MEDROUTE_API_URL"];
    process.env["GEMINI_API_KEY"] = "test-api-key";
    const fetchMock = geminiOnly();
    vi.stubGlobal("fetch", fetchMock);

    const first = await analyze(2);
    const second = await analyze(2);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("limits each client, tells them when to retry, and still serves cached results", async () => {
    delete process.env["MEDROUTE_API_URL"];
    process.env["GEMINI_API_KEY"] = "test-api-key";
    vi.stubGlobal("fetch", geminiOnly());

    expect((await analyze(2)).status).toBe(200);
    for (let i = 1; i < PER_CLIENT.max; i++) {
      expect(takeAnalysis("203.0.113.7").ok).toBe(true);
    }
    const limited = await analyze(1);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await limited.json()).error).toMatch(
      /^Too many analyses in a short time\. Try again in about \d+ minutes\.$/,
    );

    // The network it already analyzed is still answered, and other clients aren't affected.
    expect((await analyze(2)).status).toBe(200);
    expect((await analyze(1, "198.51.100.2")).status).toBe(200);
  });

  it("frees a client's slots as their window passes", () => {
    const start = 1_000_000;
    for (let i = 0; i < PER_CLIENT.max; i++) expect(takeAnalysis("a", start).ok).toBe(true);
    expect(takeAnalysis("a", start + 1000)).toEqual({
      ok: false,
      retryAfterSeconds: PER_CLIENT.windowMs / 1000 - 1,
    });
    expect(takeAnalysis("a", start + PER_CLIENT.windowMs).ok).toBe(true);
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
