import { ALWAYS_OPEN, cloneHours, DAYS, type WeeklyHours } from "./hours";
import type { GridPower } from "./power";
import type { DemoState, Location } from "./types";

/** Staffed `open`–`close` (whole hours) on the given days, closed otherwise. */
function staffed(open: number, close: number, days: "every day" | "Mon–Sat"): WeeklyHours {
  return Object.fromEntries(
    DAYS.map((d) => [
      d,
      days === "Mon–Sat" && d === "sun" ? [] : [{ open: open * 60, close: close * 60 }],
    ]),
  ) as WeeklyHours;
}

const power = (from: number, until: number): GridPower => ({ from, until });

/**
 * A compact Ghana corridor scenario for a fast, repeatable live demo. Grid power is rationed, so
 * most sites only have power part of the day, at different times. The hospitals are staffed
 * around the clock but can only keep medicines cold while the grid is on; Cape Coast's power
 * already covers its staffed hours, so solar wouldn't change anything there.
 */
export function createSampleNetwork(): DemoState {
  const createdAt = new Date().toISOString();
  const site = (
    id: string,
    name: string,
    address: string,
    lat: number,
    lng: number,
    kind: "warehouse" | "clinic",
    hours: WeeklyHours,
    gridPower: GridPower,
    population: number | null = null,
  ): Location => ({
    id,
    name,
    address,
    lat,
    lng,
    kind,
    portMode: null,
    hours,
    gridPower,
    population,
    createdAt,
  });

  const locations: Location[] = [
    {
      id: "sample-tema-port",
      name: "Tema Port",
      address: "Tema, Ghana",
      lat: 5.6698,
      lng: 0.0166,
      kind: "port",
      portMode: "sea",
      hours: cloneHours(ALWAYS_OPEN),
      gridPower: null,
      population: null,
      createdAt,
    },
    site(
      "sample-accra-warehouse",
      "Accra Medical Warehouse",
      "Accra, Ghana",
      5.6037,
      -0.187,
      "warehouse",
      staffed(7, 19, "Mon–Sat"),
      power(6, 18),
    ),
    site(
      "sample-kumasi-warehouse",
      "Kumasi Medical Warehouse",
      "Kumasi, Ghana",
      6.6885,
      -1.6244,
      "warehouse",
      staffed(6, 22, "every day"),
      power(10, 18),
    ),
    site(
      "sample-accra-clinic",
      "Korle Bu Clinic",
      "Accra, Ghana",
      5.5351,
      -0.2256,
      "clinic",
      cloneHours(ALWAYS_OPEN),
      power(6, 18),
      450000,
    ),
    site(
      "sample-cape-coast-clinic",
      "Cape Coast Clinic",
      "Cape Coast, Ghana",
      5.1053,
      -1.2466,
      "clinic",
      staffed(8, 17, "every day"),
      power(7, 19),
      280000,
    ),
    site(
      "sample-kumasi-clinic",
      "Komfo Anokye Clinic",
      "Kumasi, Ghana",
      6.693,
      -1.6244,
      "clinic",
      cloneHours(ALWAYS_OPEN),
      power(14, 22),
      620000,
    ),
    site(
      "sample-tamale-clinic",
      "Tamale Clinic",
      "Tamale, Ghana",
      9.4075,
      -0.8533,
      "clinic",
      staffed(8, 20, "every day"),
      power(16, 24),
      390000,
    ),
  ];
  return {
    locations,
    connections: [
      { id: "sample-port-accra", fromId: "sample-tema-port", toId: "sample-accra-warehouse" },
      { id: "sample-port-kumasi", fromId: "sample-tema-port", toId: "sample-kumasi-warehouse" },
      { id: "sample-accra-korle", fromId: "sample-accra-warehouse", toId: "sample-accra-clinic" },
      {
        id: "sample-accra-cape",
        fromId: "sample-accra-warehouse",
        toId: "sample-cape-coast-clinic",
      },
      {
        id: "sample-kumasi-kumasi",
        fromId: "sample-kumasi-warehouse",
        toId: "sample-kumasi-clinic",
      },
      {
        id: "sample-kumasi-tamale",
        fromId: "sample-kumasi-warehouse",
        toId: "sample-tamale-clinic",
      },
    ],
    budget: { unitCost: 12000, total: 36000 },
  };
}
