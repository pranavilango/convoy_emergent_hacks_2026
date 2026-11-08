import {
  analyzeSolarAllocation,
  generateSolarAllocation,
  isJsonObject,
  type SolarAllocationNetwork,
} from "@/lib/solar-allocation/analyze";
import { isLocationKind, isPortMode } from "@/lib/demo/kinds";

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

  if (!isJsonObject(body) || !isSolarAllocationNetwork(body["network"])) {
    return Response.json(
      { error: "Request body must include a valid network with locations and connections." },
      { status: 400 },
    );
  }

  try {
    const allocation = await generateSolarAllocation(body["network"]);
    const analysis = await analyzeSolarAllocation(allocation);
    return Response.json({ allocation, analysis });
  } catch (error) {
    console.error("Solar allocation analysis failed:", error);

    if (error instanceof Error && error.message === "GEMINI_API_KEY is not configured.") {
      return Response.json(
        { error: "Gemini analysis is not configured on the server." },
        { status: 503 },
      );
    }

    return Response.json(
      { error: "Unable to analyze the solar allocation right now." },
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
      (location["portMode"] === null || isPortMode(location["portMode"])),
  );
  const connectionsValid = value["connections"].every(
    (connection) =>
      isJsonObject(connection) &&
      typeof connection["fromId"] === "string" &&
      typeof connection["toId"] === "string",
  );

  return locationsValid && connectionsValid;
}
