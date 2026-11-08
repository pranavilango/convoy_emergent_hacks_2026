import { ALWAYS_OPEN, DEFAULT_HOURS, cloneHours } from "./hours";
import type { DemoState, Location } from "./types";

/** A compact Ghana corridor scenario for a fast, repeatable live demo. */
export function createSampleNetwork(): DemoState {
  const createdAt = new Date().toISOString();
  const locations: Location[] = [
    { id: "sample-tema-port", name: "Tema Port", address: "Tema, Ghana", lat: 5.6698, lng: 0.0166, kind: "port", portMode: "sea", hours: cloneHours(ALWAYS_OPEN), population: null, createdAt },
    { id: "sample-accra-warehouse", name: "Accra Medical Warehouse", address: "Accra, Ghana", lat: 5.6037, lng: -0.187, kind: "warehouse", portMode: null, hours: cloneHours(DEFAULT_HOURS), population: null, createdAt },
    { id: "sample-kumasi-warehouse", name: "Kumasi Medical Warehouse", address: "Kumasi, Ghana", lat: 6.6885, lng: -1.6244, kind: "warehouse", portMode: null, hours: cloneHours(DEFAULT_HOURS), population: null, createdAt },
    { id: "sample-accra-clinic", name: "Korle Bu Clinic", address: "Accra, Ghana", lat: 5.5351, lng: -0.2256, kind: "clinic", portMode: null, hours: cloneHours(DEFAULT_HOURS), population: 450000, createdAt },
    { id: "sample-cape-coast-clinic", name: "Cape Coast Clinic", address: "Cape Coast, Ghana", lat: 5.1053, lng: -1.2466, kind: "clinic", portMode: null, hours: cloneHours(DEFAULT_HOURS), population: 280000, createdAt },
    { id: "sample-kumasi-clinic", name: "Komfo Anokye Clinic", address: "Kumasi, Ghana", lat: 6.693, lng: -1.6244, kind: "clinic", portMode: null, hours: cloneHours(DEFAULT_HOURS), population: 620000, createdAt },
    { id: "sample-tamale-clinic", name: "Tamale Clinic", address: "Tamale, Ghana", lat: 9.4075, lng: -0.8533, kind: "clinic", portMode: null, hours: cloneHours(DEFAULT_HOURS), population: 390000, createdAt },
  ];
  return {
    locations,
    connections: [
      { id: "sample-port-accra", fromId: "sample-tema-port", toId: "sample-accra-warehouse" },
      { id: "sample-port-kumasi", fromId: "sample-tema-port", toId: "sample-kumasi-warehouse" },
      { id: "sample-accra-korle", fromId: "sample-accra-warehouse", toId: "sample-accra-clinic" },
      { id: "sample-accra-cape", fromId: "sample-accra-warehouse", toId: "sample-cape-coast-clinic" },
      { id: "sample-kumasi-kumasi", fromId: "sample-kumasi-warehouse", toId: "sample-kumasi-clinic" },
      { id: "sample-kumasi-tamale", fromId: "sample-kumasi-warehouse", toId: "sample-tamale-clinic" },
    ],
    budget: { unitCost: 12000, total: 24000 },
  };
}
