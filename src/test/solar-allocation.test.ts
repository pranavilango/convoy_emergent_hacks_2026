import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/solar-allocation/route";
import {
  analyzeSolarAllocation,
  type SolarAllocation,
  type SolarAllocationNetwork,
} from "@/lib/solar-allocation/analyze";

const savedEnv = {
  apiKey: process.env["GEMINI_API_KEY"],
  model: process.env["GEMINI_MODEL"],
  backend: process.env["MEDROUTE_API_URL"],
};

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
    },
    {
      id: "clinic-1",
      name: "Clinic A",
      kind: "clinic",
      lat: -2.5,
      lng: 32.9,
      population: 12_400,
      hours: dailyHours,
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
    expect(String(options.body)).toContain("baseline_weighted_hours");
    expect(String(options.body)).toContain("21.64");
    expect(String(options.body).toLowerCase()).toContain("do not solve the optimization again");
    expect(String(options.body)).toContain("Do not mention the solver");
    expect(String(options.body)).toContain("Clinic A");
    expect(String(options.body)).toContain("12400");
  });

  it("returns the Rust allocation with Gemini's explanation", async () => {
    process.env["GEMINI_API_KEY"] = "test-api-key";
    process.env["MEDROUTE_API_URL"] = "http://medroute.test/";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(allocation), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: "The selected sites reduce weighted waits." }] } },
            ],
          }),
          { status: 200 },
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
      analysis: "The selected sites reduce weighted waits.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    expect(graph.nodes[1]).toMatchObject({
      kind: "pass_through",
      open_from: 9,
      open_until: 16,
    });
    expect(graph.nodes[2]).toMatchObject({ kind: "destination", priority: 12_400 });
    expect(graph.edges).toEqual([
      { from: "port-1", to: "warehouse-1" },
      { from: "warehouse-1", to: "clinic-1" },
    ]);
  });

  it("reports missing Gemini configuration instead of returning an unexplained allocation", async () => {
    delete process.env["GEMINI_API_KEY"];
    process.env["MEDROUTE_API_URL"] = "http://medroute.test/";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(allocation), { status: 200 }));
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
    expect(fetchMock).toHaveBeenCalledOnce();
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

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
