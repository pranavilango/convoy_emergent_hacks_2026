import { describe, expect, it } from "vitest";

import { ALWAYS_OPEN, cloneHours, DEFAULT_HOURS } from "@/lib/demo/hours";
import type { Connection, Location } from "@/lib/demo/types";
import { analysisIssues } from "@/lib/solar-allocation/readiness";

const site = (id: string, kind: Location["kind"], extra: Partial<Location> = {}): Location => ({
  id,
  name: id.toUpperCase(),
  address: "",
  lat: 0,
  lng: 0,
  kind,
  portMode: kind === "port" ? "sea" : null,
  hours: kind === "port" ? cloneHours(ALWAYS_OPEN) : cloneHours(DEFAULT_HOURS),
  gridPower: kind === "port" ? null : { from: 8, until: 16 },
  population: kind === "clinic" ? 1000 : null,
  createdAt: "t",
  ...extra,
});
const link = (fromId: string, toId: string): Connection => ({
  id: `${fromId}-${toId}`,
  fromId,
  toId,
});

const chain = [site("p", "port"), site("w", "warehouse"), site("c", "clinic")];
const chainLinks = [link("p", "w"), link("w", "c")];

describe("analysisIssues", () => {
  it("is empty for a complete, linked network with a budget", () => {
    expect(analysisIssues(chain, chainLinks, 2)).toEqual([]);
  });

  it("asks for each missing kind and for a budget", () => {
    expect(analysisIssues([], [], null)).toEqual([
      "Add at least one port, one warehouse, one clinic.",
      "Enter the cost per solar unit and the total budget.",
    ]);
    expect(analysisIssues(chain, chainLinks, 0)).toEqual([
      "The budget must cover at least one solar unit.",
    ]);
  });

  it("names sites with missing supply links", () => {
    expect(analysisIssues(chain, [link("p", "w")], 1)).toEqual([
      "W doesn't supply any clinic yet.",
      "C has no warehouse supplying it.",
      "Your sites form 2 separate networks. Link them into one, or remove the sites you aren't analyzing.",
    ]);
  });

  it("catches two separate supply chains", () => {
    const second = [site("p2", "port"), site("w2", "warehouse"), site("c2", "clinic")];
    expect(
      analysisIssues([...chain, ...second], [...chainLinks, link("p2", "w2"), link("w2", "c2")], 1),
    ).toEqual([
      "Your sites form 2 separate networks. Link them into one, or remove the sites you aren't analyzing.",
    ]);
  });

  it("flags hours the optimizer can't model, and clinics without a population", () => {
    const closed = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
    const overnight = cloneHours(DEFAULT_HOURS);
    overnight.fri = [{ open: 1320, close: 120 }];
    const sites = [
      chain[0]!,
      site("w", "warehouse", { hours: closed }),
      site("c", "clinic", { hours: overnight, population: null }),
    ];
    expect(analysisIssues(sites, chainLinks, 1)).toEqual([
      "W is closed every day. Give it opening hours.",
      "C has an overnight shift (22:00–02:00 (+1)), which the optimizer can't model yet. End it at midnight.",
      "Set how many people C serves.",
    ]);
  });
});
