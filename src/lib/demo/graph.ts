import type { Connection } from "./types";

/**
 * Connections are directed supply links `fromId → toId`: port → warehouse or warehouse → clinic
 * (the rule lives in `kinds.ts` and is enforced by the reducer).
 */

export function involves(connection: Connection, locationId: string): boolean {
  return connection.fromId === locationId || connection.toId === locationId;
}

/** The location at the other end of `connection` from `locationId`. */
export function otherEnd(connection: Connection, locationId: string): string {
  return connection.fromId === locationId ? connection.toId : connection.fromId;
}

/** The connection from `fromId` to `toId`, if any (direction matters). */
export function findConnection(
  connections: readonly Connection[],
  fromId: string,
  toId: string,
): Connection | undefined {
  return connections.find((c) => c.fromId === fromId && c.toId === toId);
}

export function connectionsOf(connections: readonly Connection[], locationId: string) {
  return connections.filter((c) => involves(c, locationId));
}

export function outgoing(connections: readonly Connection[], locationId: string) {
  return connections.filter((c) => c.fromId === locationId);
}

export function incoming(connections: readonly Connection[], locationId: string) {
  return connections.filter((c) => c.toId === locationId);
}

/** Total connections (in + out) per location id. Locations with none are absent. */
export function degrees(connections: readonly Connection[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of connections) {
    out.set(c.fromId, (out.get(c.fromId) ?? 0) + 1);
    out.set(c.toId, (out.get(c.toId) ?? 0) + 1);
  }
  return out;
}
