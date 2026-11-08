import { describe, expect, it } from "vitest";

import { unitsAffordable } from "@/lib/demo/budget";
import { createSampleNetwork } from "@/lib/demo/sample-network";
import { explanationFacts, generateSolarAllocation } from "@/lib/solar-allocation/analyze";
import { summarizeAnalysis } from "@/lib/solar-allocation/summary";

describe("the analysis in plain terms, on the Ghana sample (real engine)", () => {
  async function analyze() {
    const sample = createSampleNetwork();
    const network = { locations: sample.locations, connections: sample.connections };
    const allocation = await generateSolarAllocation(network, unitsAffordable(sample.budget)!);
    return { sample, network, allocation };
  }

  it("says how much sooner medicines reach clinics on average", async () => {
    const { sample, allocation } = await analyze();
    const s = summarizeAnalysis(allocation, sample.locations, sample.connections);
    // Shown to one decimal, and the arithmetic on screen adds up: 10.3 − 6.9 = 3.4.
    expect([s.before, s.after, s.saved]).toEqual([10.3, 6.9, 3.4]);
    expect(Math.round(s.share * 100)).toBe(33);
    // The engine's own figures, unrounded.
    expect(allocation.baseline_weighted_hours).toBeCloseTo(10.33, 2);
    expect(allocation.optimized_weighted_hours).toBeCloseTo(6.87, 2);
  });

  it("splits the time into driving, which solar never changes, and waiting, which it cuts", async () => {
    const { sample, allocation } = await analyze();
    const { split, before, after } = summarizeAnalysis(
      allocation,
      sample.locations,
      sample.connections,
    );
    expect(split).toEqual({ driving: 3.8, waitingBefore: 6.5, waitingAfter: 3.1 });
    expect(split!.driving + split!.waitingBefore).toBeCloseTo(before, 9);
    expect(split!.driving + split!.waitingAfter).toBeCloseTo(after, 9);
    // The engine's own split, unrounded: the drive is the same with and without solar.
    expect(allocation.baseline_breakdown!.travel_hours).toBeCloseTo(
      allocation.optimized_breakdown!.travel_hours,
      9,
    );
    expect(allocation.baseline_breakdown!.waiting_hours).toBeCloseTo(6.53, 2);
    expect(allocation.optimized_breakdown!.waiting_hours).toBeCloseTo(3.07, 2);
  });

  it("gives each clinic's own time, faster ones first, and who benefits", async () => {
    const { sample, allocation } = await analyze();
    const s = summarizeAnalysis(allocation, sample.locations, sample.connections);
    expect(s.clinics!.map((c) => [c.name, c.before, c.after, c.faster])).toEqual([
      ["Komfo Anokye Clinic", 11.8, 4.9, true],
      ["Tamale Clinic", 16.9, 12.5, true],
      ["Korle Bu Clinic", 4.1, 4.1, false],
      ["Cape Coast Clinic", 7.8, 7.8, false],
    ]);
    expect(s.peopleSooner).toBe(1_010_000);
    expect(s.peopleTotal).toBe(1_740_000);
    // The headline is the engine's clinic times averaged, bigger clinics counting more.
    const people = new Map(sample.locations.map((l) => [l.id, l.population ?? 0]));
    const weighted =
      allocation.destinations!.reduce(
        (sum, d) => sum + people.get(d.id)! * d.optimized.total_hours,
        0,
      ) / s.peopleTotal;
    expect(weighted).toBeCloseTo(allocation.optimized_weighted_hours, 9);
  });

  it("beats the obvious choice, solar on the biggest clinics, and says why", async () => {
    const { sample, allocation } = await analyze();
    const { obvious } = summarizeAnalysis(allocation, sample.locations, sample.connections);
    expect(obvious!.sites).toEqual(["Korle Bu Clinic", "Komfo Anokye Clinic", "Tamale Clinic"]);
    expect(obvious!.hours).toBe(8.9);
    expect(obvious!.convoyFasterBy).toBe(2); // 8.9 − 6.9, as shown
    expect(allocation.priority_first!.weighted_hours).toBeCloseTo(8.92, 2);
    expect(obvious!.sameAsPlan).toBe(false);
    expect(obvious!.warehouses).toEqual([
      { name: "Kumasi Medical Warehouse", clinics: ["Komfo Anokye Clinic", "Tamale Clinic"] },
    ]);
  });

  it("gives Gemini the same figures, in the same plain terms", async () => {
    const { network, allocation } = await analyze();
    const facts = explanationFacts(network, allocation);
    expect(facts).toMatchObject({
      averagePortToClinicHours: { withoutSolar: 10.3, withPlan: 6.9 },
      hoursSoonerOnAverage: 3.4,
      percentFaster: 33,
      drivingHours: 3.8,
      waitingForStaffAndPowerHours: { withoutSolar: 6.5, withPlan: 3.1 },
      peopleAtClinicsGettingMedicinesSooner: 1_010_000,
      obviousAlternative: { averagePortToClinicHours: 8.9, planIsFasterByHours: 2 },
    });
    expect(facts.sites.find((s) => s.name === "Komfo Anokye Clinic")).toMatchObject({
      portToClinicHours: { withoutSolar: 11.8, withPlan: 4.9 },
    });
    expect(JSON.stringify(facts)).not.toMatch(/weighted/i);
  });
});
