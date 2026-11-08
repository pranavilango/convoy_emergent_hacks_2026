import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/solar-allocation/route";
import { analyzeSolarAllocation, type SolarAllocation } from "@/lib/solar-allocation/analyze";

const originalApiKey = process.env["GEMINI_API_KEY"];
const originalModel = process.env["GEMINI_MODEL"];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();

  if (originalApiKey === undefined) {
    delete process.env["GEMINI_API_KEY"];
  } else {
    process.env["GEMINI_API_KEY"] = originalApiKey;
  }

  if (originalModel === undefined) {
    delete process.env["GEMINI_MODEL"];
  } else {
    process.env["GEMINI_MODEL"] = originalModel;
  }
});

const allocation: SolarAllocation = {
  networkSummary: "Two care sites are recommended for extended hours.",
  recommendations: [
    {
      locationId: "clinic-1",
      locationName: "Clinic A",
      kind: "clinic",
      estimatedWaitHoursBefore: 12,
      estimatedWaitHoursAfter: 4,
      rationale: "It is the endpoint providing patient care.",
    },
    {
      locationId: "warehouse-1",
      locationName: "Central Store",
      kind: "warehouse",
      estimatedWaitHoursBefore: 8,
      estimatedWaitHoursAfter: 2,
      rationale: "It supplies the clinic.",
    },
  ],
  limitations: ["Wait times are hypothetical estimates, not measured data."],
};

const network = {
  locations: [
    { id: "port-1", name: "Dar Port", kind: "port", portMode: "sea" },
    { id: "warehouse-1", name: "Central Store", kind: "warehouse", portMode: null },
    { id: "clinic-1", name: "Clinic A", kind: "clinic", portMode: null },
  ],
  connections: [
    { fromId: "port-1", toId: "warehouse-1" },
    { fromId: "warehouse-1", toId: "clinic-1" },
  ],
};

describe("solar allocation analysis", () => {
  it("sends the allocation to Gemini and returns its analysis", async () => {
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

    await expect(analyzeSolarAllocation(allocation)).resolves.toBe(
      "Prioritize the clinic allocation.",
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/gemini-test-model:generateContent");
    expect(url).not.toContain("test-api-key");
    expect(new Headers(options.headers).get("x-goog-api-key")).toBe("test-api-key");
    expect(String(options.body)).toContain("Clinic A");
  });

  it("rejects requests without a valid network", async () => {
    const response = await POST(
      new Request("http://localhost/api/solar-allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: { locations: [], connections: "invalid" } }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must include a valid network with locations and connections.",
    });
  });

  it("uses Gemini twice: first to generate 24/7 recommendations, then to analyze their JSON", async () => {
    process.env["GEMINI_API_KEY"] = "test-api-key";
    process.env["GEMINI_MODEL"] = "gemini-test-model";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(allocation) }] } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Clinic A is the top priority." }] } }],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/solar-allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      allocation,
      analysis: "Clinic A is the top priority.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("exactly two recommendations");
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("estimatedWaitHoursBefore");
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain("networkSummary");
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain("hypothetical");
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain("estimatedWaitHoursAfter");
  });

  it("passes hours, clinic population, and link distances on to Gemini", async () => {
    process.env["GEMINI_API_KEY"] = "test-api-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(allocation) }] } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const detailed = {
      locations: [
        { ...network.locations[0], population: null, hours: ["Every day 24 hours"] },
        {
          ...network.locations[1],
          population: null,
          hours: ["Mon–Fri 09:00–17:00", "Sat–Sun Closed"],
        },
        { ...network.locations[2], population: 12_400, hours: ["Every day 08:00–16:00"] },
      ],
      connections: [
        { ...network.connections[0], distanceKm: 42.5 },
        { ...network.connections[1], distanceKm: 118 },
      ],
    };

    const response = await POST(
      new Request("http://localhost/api/solar-allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: detailed }),
      }),
    );

    expect(response.status).toBe(200);
    const prompt = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(prompt).toContain("prefer sites that are not already open 24/7");
    for (const detail of ["12400", "Sat–Sun Closed", "42.5", "118"]) {
      expect(prompt).toContain(detail);
    }
  });

  it("rejects malformed optional details", async () => {
    for (const bad of [
      { locations: [{ ...network.locations[2], population: -1 }], connections: [] },
      { locations: [{ ...network.locations[2], hours: "9-5" }], connections: [] },
      { locations: [], connections: [{ ...network.connections[0], distanceKm: "far" }] },
    ]) {
      const response = await POST(
        new Request("http://localhost/api/solar-allocation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ network: bad }),
        }),
      );
      expect(response.status).toBe(400);
    }
  });

  it("rejects generated recommendations for ports or with invalid wait-time changes", async () => {
    process.env["GEMINI_API_KEY"] = "test-api-key";
    const invalidAllocation = {
      ...allocation,
      recommendations: [
        {
          ...allocation.recommendations[0],
          locationId: "port-1",
          locationName: "Dar Port",
          kind: "port",
        },
        allocation.recommendations[1],
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(invalidAllocation) }] } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(
      new Request("http://localhost/api/solar-allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network }),
      }),
    );

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({
      error: "Unable to analyze the solar allocation right now.",
    });
  });

  it("reports missing server credentials without exposing provider details", async () => {
    delete process.env["GEMINI_API_KEY"];
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(
      new Request("http://localhost/api/solar-allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network }),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Gemini analysis is not configured on the server.",
    });
  });
});
