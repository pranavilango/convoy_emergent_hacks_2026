import {
  analyzeSolarAllocation,
  generateSolarAllocation,
  GeminiApiError,
  isJsonObject,
  MedrouteApiError,
  type SolarAllocationNetwork,
} from "@/lib/solar-allocation/analyze";
import { DAYS } from "@/lib/demo/hours";
import { isLocationKind } from "@/lib/demo/kinds";

const MAX_REQUEST_SIZE = 1_000_000;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_SIZE) {
    return Response.json({ error: "Network payload must be 1 MB or smaller." }, { status: 413 });
  }
  let body: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_SIZE) {
      return Response.json({ error: "Network payload must be 1 MB or smaller." }, { status: 413 });
    }
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Request body must contain valid JSON." }, { status: 400 });
  }

  if (
    !isJsonObject(body) ||
    !isSolarAllocationNetwork(body["network"]) ||
    !Number.isSafeInteger(body["n"]) ||
    (body["n"] as number) < 1
  ) {
    return Response.json(
      {
        error: "Request body must include a valid network and a positive integer solar-unit count.",
      },
      { status: 400 },
    );
  }

  let stage: "Rust backend" | "Gemini" = "Rust backend";
  try {
    const allocation = await generateSolarAllocation(body["network"], body["n"] as number);
    stage = "Gemini";
    const analysis = await analyzeSolarAllocation(body["network"], allocation);
    return Response.json({ allocation, analysis });
  } catch (error) {
    console.error("Solar allocation analysis failed:", error);

    if (error instanceof GeminiApiError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof MedrouteApiError) {
      const status = [400, 413, 422].includes(error.status) ? error.status : 502;
      return Response.json({ error: error.message }, { status });
    }

    if (
      stage === "Rust backend" &&
      (error instanceof TypeError ||
        (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)))
    ) {
      return Response.json(
        {
          error:
            "Cannot reach the Rust allocation service at the configured MEDROUTE_API_URL (default http://127.0.0.1:8080). Start it with `cargo run --release` or set MEDROUTE_API_URL to its address.",
        },
        { status: 503 },
      );
    }

    if (
      stage === "Gemini" &&
      (error instanceof TypeError ||
        (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)))
    ) {
      return Response.json(
        { error: "Could not reach Gemini to explain the allocation. Check server network access and try again." },
        { status: 502 },
      );
    }

    if (error instanceof Error && error.message.includes("opening hours")) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json(
      {
        error:
          "Unable to analyze the solar allocation right now. Check the Rust backend and try again.",
      },
      { status: 502 },
    );
  }
}

function isSolarAllocationNetwork(value: unknown): value is SolarAllocationNetwork {
  if (
    !isJsonObject(value) ||
    !Array.isArray(value["locations"]) ||
    !Array.isArray(value["connections"])
  ) {
    return false;
  }

  const locationsValid = value["locations"].every(
    (location) =>
      isJsonObject(location) &&
      typeof location["id"] === "string" &&
      typeof location["name"] === "string" &&
      isLocationKind(location["kind"]) &&
      isFiniteNumber(location["lat"]) &&
      location["lat"] >= -90 &&
      location["lat"] <= 90 &&
      isFiniteNumber(location["lng"]) &&
      location["lng"] >= -180 &&
      location["lng"] <= 180 &&
      (location["population"] === undefined ||
        location["population"] === null ||
        (isFiniteNumber(location["population"]) && location["population"] >= 0)) &&
      isWeeklyHours(location["hours"]),
  );
  const connectionsValid = value["connections"].every(
    (connection) =>
      isJsonObject(connection) &&
      typeof connection["fromId"] === "string" &&
      typeof connection["toId"] === "string",
  );

  return locationsValid && connectionsValid;
}

function isWeeklyHours(
  value: unknown,
): value is SolarAllocationNetwork["locations"][number]["hours"] {
  if (!isJsonObject(value)) return false;
  return DAYS.every(
    (day) =>
      Array.isArray(value[day]) &&
      value[day].every(
        (range) =>
          isJsonObject(range) &&
          Number.isInteger(range["open"]) &&
          Number.isInteger(range["close"]) &&
          (range["open"] as number) >= 0 &&
          (range["open"] as number) < 1440 &&
          (range["close"] as number) >= 0 &&
          (range["close"] as number) <= 1440,
      ),
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
