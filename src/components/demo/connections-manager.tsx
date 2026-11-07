"use client";

import { useState } from "react";

import { demoActions } from "@/lib/demo/store";
import type { Connection, Location } from "@/lib/demo/types";

import { Button, SectionLabel } from "./controls";
import { Select } from "./select";

export function ConnectionsManager({
  locations,
  connections,
}: {
  locations: Location[];
  connections: Connection[];
}) {
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const sourceId = locations.some((location) => location.id === fromId) ? fromId : locations[0]?.id;
  const targetId = locations.some((location) => location.id === toId && location.id !== sourceId)
    ? toId
    : locations.find((location) => location.id !== sourceId)?.id;
  const existing = connections.some(
    (connection) => connection.fromId === sourceId && connection.toId === targetId,
  );
  const locationById = new Map(locations.map((location) => [location.id, location]));

  function addConnection() {
    if (!sourceId || !targetId || existing) return;
    demoActions.connectLocations(sourceId, targetId);
  }

  return (
    <section aria-labelledby="connections-heading" className="space-y-4">
      <h2 id="connections-heading">
        <SectionLabel
          index="04"
          aside={`${connections.length} ${connections.length === 1 ? "connection" : "connections"}`}
        >
          Connections
        </SectionLabel>
      </h2>

      {locations.length < 2 ? (
        <p className="border-y border-foreground/30 py-4 text-sm opacity-80">
          Add at least two locations to connect them.
        </p>
      ) : (
        <div className="space-y-4">
          <Select
            label="From"
            value={sourceId}
            onChange={setFromId}
            options={locations.map((location) => ({ value: location.id, label: location.name }))}
          />
          <Select
            label="To"
            value={targetId}
            onChange={setToId}
            options={locations
              .filter((location) => location.id !== sourceId)
              .map((location) => ({ value: location.id, label: location.name }))}
          />
          <Button
            className="w-full justify-between"
            disabled={!sourceId || !targetId || existing}
            onClick={addConnection}
          >
            {existing ? "Connection already exists" : "Add connection"}
            <span aria-hidden>→</span>
          </Button>
        </div>
      )}

      {connections.length > 0 && (
        <ul className="divide-y divide-foreground/30 border-y border-foreground/30">
          {connections.map((connection) => {
            const from = locationById.get(connection.fromId);
            const to = locationById.get(connection.toId);
            if (!from || !to) return null;
            return (
              <li
                key={connection.id}
                className="flex items-center justify-between gap-3 py-3 text-sm"
              >
                <span className="min-w-0 truncate">
                  {from.name} <span aria-label="to">→</span> {to.name}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove connection from ${from.name} to ${to.name}`}
                  onClick={() => demoActions.removeConnection(connection.id)}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
