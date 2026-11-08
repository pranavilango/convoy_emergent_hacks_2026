import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AddLocationForm } from "@/components/demo/add-location-form";
import { AnalysisText } from "@/components/demo/analysis-text";
import { DemoApp } from "@/components/demo/demo-app";
import { Select } from "@/components/demo/select";
import { GridPowerField } from "@/components/demo/grid-power-field";
import { HoursEditor } from "@/components/demo/hours-editor";
import { DRAG_KIND_TYPE, LocationKinds } from "@/components/demo/location-kinds";
import { cloneHours, DEFAULT_HOURS, type WeeklyHours } from "@/lib/demo/hours";
import type { LocationKind } from "@/lib/demo/kinds";
import type { GridPower } from "@/lib/demo/power";
import { __resetDemoStore, demoActions, STORAGE_KEY, useDemoState } from "@/lib/demo/store";
import { __resetTour, TOUR_STORAGE_KEY } from "@/lib/demo/tour";

// The Maps SDK can't run in jsdom. These tests cover the no-key path and pure UI; the map itself
// is exercised manually against the real API.
vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => children,
  Map: () => null,
  AdvancedMarker: () => null,
  ColorScheme: { DARK: "DARK", LIGHT: "LIGHT", FOLLOW_SYSTEM: "FOLLOW_SYSTEM" },
  useMap: () => null,
  useMapsLibrary: () => null,
}));

beforeEach(() => {
  window.localStorage.clear();
  // These tests are about the editor; the first-visit tour has its own tests (tour.test.tsx).
  window.localStorage.setItem(TOUR_STORAGE_KEY, "seen");
  act(() => {
    __resetDemoStore();
    __resetTour();
  });
});

/** Expand a location's row in the Locations section. */
function openLocation(name: string) {
  const list = screen.getByRole("region", { name: /Locations/ });
  fireEvent.click(within(list).getByRole("button", { name: new RegExp(`^${name}`) }));
}

function pick(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: new RegExp(option) }));
}

let nextLng = 39;
function addLocation(kind: LocationKind, name: string) {
  // Spread sites out so distances aren't zero.
  nextLng += 0.5;
  return demoActions.addLocation({
    name,
    address: `${name} address`,
    lat: -6.8,
    lng: nextLng,
    kind,
    portMode: kind === "port" ? "sea" : null,
    hours: cloneHours(DEFAULT_HOURS),
    population: kind === "clinic" ? 1200 : null,
    gridPower: kind === "port" ? null : { from: 8, until: 16 },
  });
}

/** Port → Warehouse → Clinic. */
function addChain() {
  const p = addLocation("port", "Dar Port");
  const w = addLocation("warehouse", "Central Store");
  const c = addLocation("clinic", "Mwanza Clinic");
  demoActions.connectLocations(p, w);
  demoActions.connectLocations(w, c);
  return { p, w, c };
}

describe("demo store persistence", () => {
  it("saves to localStorage and loads it back", () => {
    act(() => {
      addLocation("clinic", "Mwanza Clinic");
    });
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    expect(saved.version).toBe(2);
    expect(saved.state.locations[0]).toMatchObject({ name: "Mwanza Clinic", kind: "clinic" });

    act(() => __resetDemoStore());
    render(<DemoApp />);
    expect(screen.getByText("Mwanza Clinic")).toBeInTheDocument();
  });

  it("discards data saved before the medical supply network", () => {
    window.localStorage.setItem("convoy.demo.v1", JSON.stringify({ version: 1, state: {} }));
    act(() => __resetDemoStore());
    render(<DemoApp />);
    expect(window.localStorage.getItem("convoy.demo.v1")).toBeNull();
    expect(screen.getByText(/No locations yet/)).toBeInTheDocument();
  });

  it("starts fresh when stored data is corrupt", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    act(() => __resetDemoStore());
    render(<DemoApp />);
    expect(screen.getByText(/No locations yet/)).toBeInTheDocument();
  });
});

describe("DemoApp without an API key", () => {
  it("explains how to configure Google Maps instead of crashing", () => {
    render(<DemoApp />);
    expect(screen.getByText("Google Maps isn't configured")).toBeInTheDocument();
    expect(screen.getByText(/Address search needs Google Maps/)).toBeInTheDocument();
  });

  it("links back to the landing page", () => {
    render(<DemoApp />);
    expect(screen.getByRole("link", { name: "Back to site" })).toHaveAttribute("href", "/");
  });

  it("keeps the desktop page fixed while the network editor scrolls", () => {
    const { container } = render(<DemoApp />);
    expect(container.querySelector(".theme-night")).toHaveClass("md:overflow-hidden");
    expect(screen.getByLabelText("Network editor")).toHaveClass("min-h-0", "md:overflow-y-auto");
    expect(screen.getByRole("region", { name: "Map" })).toHaveClass("md:min-h-0");
  });
});

describe("network editor order", () => {
  it("starts with the budget, the primary constraint, then locations, connections, analysis", () => {
    render(<DemoApp />);
    const headings = within(screen.getByLabelText("Network editor"))
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual([
      "_01 BudgetUSD",
      "_02 Add a location",
      expect.stringMatching(/^_03 Location types/),
      expect.stringMatching(/^_04 Locations/),
      expect.stringMatching(/^_05 Connections/),
      "_06 Analysis",
    ]);
  });
});

describe("Ghana sample network", () => {
  it("loads from the floating bottom-right button, asking before it replaces a network", () => {
    render(<DemoApp />);
    const button = screen.getByRole("button", { name: "Load Ghana sample network" });
    expect(button).toHaveClass("fixed", "right-4", "bottom-4");
    expect(screen.queryByText(/Ready for the judges/)).toBeNull();

    fireEvent.click(button);
    expect(screen.getAllByText("Tamale Clinic").length).toBeGreaterThan(0);

    act(() => demoActions.removeLocation("sample-tamale-clinic"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.queryAllByText("Tamale Clinic")).toHaveLength(0);
    confirm.mockReturnValue(true);
    fireEvent.click(button);
    expect(screen.getAllByText("Tamale Clinic").length).toBeGreaterThan(0);
    confirm.mockRestore();
  });
});

describe("solar allocation analysis", () => {
  it("lists what blocks Analyze, then shows the optimizer's result and keeps it until edits", async () => {
    render(<DemoApp />);
    const analyzeButton = screen.getByRole("button", { name: "Analyze" });
    const checklist = () => screen.getByRole("list", { name: "Before you analyze" });
    expect(analyzeButton).toBeDisabled();
    expect(
      within(checklist()).getByText("Add at least one port, one warehouse, one clinic."),
    ).toBeInTheDocument();

    const ids = { p: "", w: "", c: "" };
    act(() => {
      ids.p = addLocation("port", "Dar Port");
      ids.w = addLocation("warehouse", "Central Store");
      ids.c = addLocation("clinic", "Mwanza Clinic");
    });
    // Unlinked sites are named, so the fix is obvious.
    expect(
      within(checklist()).getByText("Dar Port doesn't supply any warehouse yet."),
    ).toBeInTheDocument();
    expect(
      within(checklist()).getByText("Mwanza Clinic has no warehouse supplying it."),
    ).toBeInTheDocument();
    expect(analyzeButton).toBeDisabled();

    act(() => {
      demoActions.connectLocations(ids.p, ids.w);
      demoActions.connectLocations(ids.w, ids.c);
    });
    expect(
      within(checklist())
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["·Enter the cost per solar unit and the total budget."]);

    act(() => {
      demoActions.setUnitCost(1);
      demoActions.setTotalBudget(2);
    });
    expect(screen.queryByRole("list", { name: "Before you analyze" })).toBeNull();
    expect(analyzeButton).toBeEnabled();

    const allocation = {
      selected: [ids.w, ids.c],
      n: 2,
      solver: "exact",
      baseline_weighted_hours: 21.64,
      optimized_weighted_hours: 11.54,
    };
    const steps = [
      { units: 1, selected: [ids.c], weighted_hours: 15 },
      { units: 2, selected: [ids.w, ids.c], weighted_hours: 11.54 },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          allocation,
          steps,
          analysis:
            "- Mwanza Clinic: serves **1,200 people**.\n- Central Store: supplies the clinic.",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.click(analyzeButton);

    const dialog = await screen.findByRole("dialog", { name: "Network analysis" });
    const whySites = within(dialog).getByRole("region", { name: "_Why these sites" });
    expect(within(whySites).getAllByRole("listitem")[0]).toHaveTextContent(
      "Mwanza Clinic: serves 1,200 people.",
    );
    expect(within(whySites).getAllByRole("listitem")).toHaveLength(2);
    expect(within(whySites).getByText("Mwanza Clinic:")).toHaveClass("text-white", "font-semibold");
    expect(within(whySites).getByText("1,200 people")).toHaveClass("text-aqua", "font-semibold");
    expect(within(dialog).getByText("People affected")).toBeInTheDocument();
    expect(within(dialog).getAllByText("1,200 people").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Hours saved per person")).toBeInTheDocument();
    expect(within(dialog).getByText("10.1 h")).toBeInTheDocument();
    expect(within(dialog).getByText("12.1k people-hours")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/21\.6 h → 11\.5 h per person · 47% shorter/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        (_, element) =>
          element?.tagName === "LI" &&
          (element.textContent ?? "").includes(
            "Model: population-weighted, averages departure times. Solar removes the grid-power limit, while staffing hours still apply.",
          ),
      ),
    ).toBeInTheDocument();
    // Each chosen site: when it takes in medicines now (staffed 9–5, powered 8–4) and with solar,
    // people served, and where it's supplied from.
    const chosen = within(dialog).getByRole("region", { name: "_Chosen for solar" });
    expect(within(chosen).getAllByText(/Takes in medicines 09:00–16:00/)).toHaveLength(2);
    expect(within(chosen).getAllByText("→ 09:00–17:00 with solar (+1 h a day)")).toHaveLength(2);
    expect(within(chosen).getAllByText(/Grid power 08:00–16:00 \(8 h a day\)/)).toHaveLength(2);
    expect(within(chosen).getByText(/Serves 1,200 people/)).toBeInTheDocument();
    expect(within(chosen).getByText(/From Dar Port · \d+ km/)).toBeInTheDocument();
    // The popup's order: impact, chosen sites, Gemini's explanation, then the budget curve.
    expect(
      within(dialog)
        .getAllByRole("region")
        .map((r) => r.getAttribute("aria-labelledby")),
    ).toEqual([
      "allocation-impact-title",
      "allocation-sites-title",
      "allocation-explanation-title",
      "allocation-curve-title",
    ]);
    // The budget curve: no solar, then the best 1 and 2 units, from the engine's steps.
    const curve = within(dialog).getByRole("region", { name: "_Each extra solar unit" });
    const rows = within(within(curve).getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      "021.6 hNone",
      "115.0 hMwanza Clinic",
      "211.5 hCentral Store, Mwanza Clinic",
    ]);
    // It reads out the chosen plan, and any point you hover or focus.
    expect(curve).toHaveTextContent("11.5 h with 2 units: Central Store, Mwanza Clinic");
    fireEvent.focus(within(curve).getByRole("button", { name: "1 unit: 15.0 h" }));
    expect(curve).toHaveTextContent("15.0 h with 1 unit: Mwanza Clinic");
    // The popup never names the search strategy.
    expect(dialog.textContent).not.toMatch(/solver|exact|greedy/i);

    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(sent.n).toBe(2);
    expect(sent.network.locations).toContainEqual(
      expect.objectContaining({
        name: "Mwanza Clinic",
        population: 1200,
        hours: expect.objectContaining({ mon: [{ open: 540, close: 1020 }], sat: [], sun: [] }),
        gridPower: { from: 8, until: 16 },
      }),
    );

    // Closing keeps the result to reopen…
    fireEvent.click(screen.getByRole("button", { name: "Close network analysis" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByText("Last result: 2 sites lit on the map, 12.1k people-hours saved"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View result" }));
    expect(screen.getByRole("dialog", { name: "Network analysis" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close network analysis" }));

    // …until the network changes.
    act(() => demoActions.renameLocation(ids.c, "Mwanza Regional Clinic"));
    expect(
      screen.getByText("Out of date: the network changed since the last analysis."),
    ).toBeInTheDocument();
  });
});

describe("location types", () => {
  it("lists the three fixed types, with their map letter and how many are on the map", () => {
    act(() => {
      addLocation("clinic", "Clinic A");
      addLocation("clinic", "Clinic B");
    });
    render(<DemoApp />);
    const key = screen.getByRole("region", { name: /Location types/ });
    expect(
      within(key)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringMatching(/^PPort.*Sea 00 · Air 00.*00$/),
      expect.stringMatching(/^WWarehouse.*00$/),
      expect.stringMatching(/^CClinic.*Serves 2,400 people02$/),
    ]);
    // Types are fixed: nothing to create, rename, or delete.
    expect(within(key).queryByRole("button")).toBeNull();
  });
});

describe("location list", () => {
  it("changes a location's type, and removes it", () => {
    act(() => {
      addLocation("clinic", "Mwanza Clinic");
    });
    render(<DemoApp />);
    openLocation("Mwanza Clinic");

    pick("Type", "Warehouse");
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveTextContent("Warehouse");
    expect(screen.getByRole("button", { name: /^Mwanza Clinic/ })).toHaveTextContent("Warehouse");

    fireEvent.click(screen.getByRole("button", { name: "Delete location" }));
    expect(screen.queryByRole("button", { name: /^Mwanza Clinic/ })).toBeNull();
  });

  it("shows ports as always open and switches them between sea and air", () => {
    act(() => {
      addLocation("port", "Dar Port");
    });
    render(<DemoApp />);
    openLocation("Dar Port");

    expect(screen.getByText("Open 24/7. Ports never close.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sea" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Air" }));
    expect(screen.getByRole("button", { name: "Air" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Dar Port/ })).toHaveTextContent("Port · Air");
  });

  it("shows a site's type by its colour only, saying it just to screen readers", () => {
    act(() => {
      addChain();
    });
    render(<DemoApp />);
    const list = screen.getByRole("region", { name: /Locations/ });
    const row = within(list).getByRole("button", { name: /^Mwanza Clinic/ });
    expect(row).toHaveAccessibleName(/Mwanza Clinic.*Clinic$/);
    expect(within(row).getByText(", Clinic")).toHaveClass("sr-only");
    for (const label of within(list).queryAllByText(/^(Clinic|Warehouse|Port · Sea)$/)) {
      expect(label.closest(".sr-only")).not.toBeNull();
    }
  });

  it("asks before a type change that would remove connections", () => {
    act(() => {
      addChain();
    });
    render(<DemoApp />);
    openLocation("Central Store");

    pick("Type", "Clinic");
    expect(screen.getByRole("alert")).toHaveTextContent(/can't keep these 2 connections/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveTextContent("Warehouse");
    expect(screen.getAllByRole("button", { name: /^Remove connection from/ })).toHaveLength(2);

    pick("Type", "Clinic");
    fireEvent.click(screen.getByRole("button", { name: "Change + remove 2 connections" }));
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveTextContent("Clinic");
    expect(screen.queryByRole("button", { name: /^Remove connection from/ })).toBeNull();
  });
});

describe("clinic population", () => {
  it("edits a clinic's population and totals it in the type key", () => {
    act(() => {
      addLocation("clinic", "Mwanza Clinic");
      addLocation("clinic", "Arusha Clinic");
    });
    render(<DemoApp />);
    const key = screen.getByRole("region", { name: /Location types/ });
    expect(within(key).getByText("Serves 2,400 people")).toBeInTheDocument();

    openLocation("Mwanza Clinic");
    const input = screen.getByLabelText("Population served");
    expect(input).toHaveValue("1,200");

    fireEvent.change(input, { target: { value: "12k" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent(/whole number/);

    fireEvent.change(input, { target: { value: "15 000" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("15,000");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(key).getByText("Serves 16,200 people")).toBeInTheDocument();
  });

  it("asks for a population when a site becomes a clinic", () => {
    act(() => {
      addLocation("warehouse", "Central Store");
    });
    render(<DemoApp />);
    openLocation("Central Store");
    expect(screen.queryByLabelText("Population served")).toBeNull();

    pick("Type", "Clinic");
    expect(screen.getByLabelText("Population served")).toHaveValue("");
    expect(screen.getByText("Not set yet. Planning needs it.")).toBeInTheDocument();
    const key = screen.getByRole("region", { name: /Location types/ });
    expect(within(key).getByText(/1 not set/)).toBeInTheDocument();
  });
});

describe("budget", () => {
  it("shows the saved amounts even when they arrive after the fields are on screen", () => {
    render(<DemoApp />);
    const section = screen.getByRole("region", { name: /Budget/ });
    expect(within(section).getByLabelText("Cost per solar unit")).toHaveValue("");
    // e.g. the browser's saved data loading after the first render, or another tab saving.
    act(() => {
      demoActions.setUnitCost(1200);
      demoActions.setTotalBudget(10_000);
    });
    expect(within(section).getByLabelText("Cost per solar unit")).toHaveValue("1,200");
    expect(within(section).getByLabelText("Total budget")).toHaveValue("10,000");
  });

  it("saves the cost per unit and total budget, and shows how many units that covers", () => {
    render(<DemoApp />);
    const section = screen.getByRole("region", { name: /Budget/ });
    expect(within(section).getByRole("status")).toHaveTextContent(/Enter both amounts/);

    const unitCost = within(section).getByLabelText("Cost per solar unit");
    fireEvent.change(unitCost, { target: { value: "1,200" } });
    fireEvent.keyDown(unitCost, { key: "Enter" });

    const total = within(section).getByLabelText("Total budget");
    fireEvent.change(total, { target: { value: "10k" } });
    fireEvent.blur(total);
    expect(within(section).getByRole("alert")).toHaveTextContent(/number in dollars/);

    fireEvent.change(total, { target: { value: "$10000" } });
    fireEvent.blur(total);
    expect(total).toHaveValue("10,000");
    expect(within(section).getByRole("status")).toHaveTextContent(
      "Covers 8 units · $400 left over",
    );

    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    expect(saved.state.budget).toEqual({ unitCost: 1200, total: 10_000 });

    // Clearing a field clears the amount.
    fireEvent.change(unitCost, { target: { value: "" } });
    fireEvent.blur(unitCost);
    expect(within(section).getByRole("status")).toHaveTextContent(/Enter both amounts/);
  });
});

describe("connections", () => {
  it("only offers links that follow port → warehouse → clinic", () => {
    act(() => {
      addLocation("port", "Dar Port");
      addLocation("warehouse", "Central Store");
      addLocation("clinic", "Mwanza Clinic");
    });
    render(<DemoApp />);

    // Clinics supply nothing, so they're not offered as a starting point.
    fireEvent.click(screen.getByRole("combobox", { name: "From" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Dar Port",
      "Central Store",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "Dar Port" }));

    // A port only supplies warehouses; each option shows its distance.
    fireEvent.click(screen.getByRole("combobox", { name: "To" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringMatching(/^Central Store · \d+ km$/),
    ]);
    fireEvent.click(screen.getByRole("option", { name: /Central Store/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add connection/ }));

    const remove = screen.getByRole("button", {
      name: "Remove connection from Dar Port to Central Store",
    });
    // The link is listed with its straight-line distance…
    expect(remove.closest("li")).toHaveTextContent(/Dar Port→toCentral Store\d+ km/);
    // …and isn't offered again.
    pick("From", "Dar Port");
    expect(screen.getByRole("combobox", { name: "To" })).toBeDisabled();

    fireEvent.click(remove);
    expect(
      screen.queryByRole("button", { name: "Remove connection from Dar Port to Central Store" }),
    ).toBeNull();
  });

  it("shows who supplies a location and what it supplies", () => {
    act(() => {
      addChain();
      addLocation("warehouse", "North Store");
    });
    render(<DemoApp />);
    openLocation("Central Store");

    expect(screen.getByRole("button", { name: "Remove supply from Dar Port" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove supply to Mwanza Clinic" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Delete location \+ 2 connections/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove supply to Mwanza Clinic" }));
    expect(screen.queryByRole("button", { name: "Remove supply to Mwanza Clinic" })).toBeNull();

    // A clinic can be given a supplier from its own row; only warehouses are offered.
    openLocation("Mwanza Clinic");
    expect(screen.queryByText("Supplies")).toBeNull();
    fireEvent.click(screen.getByRole("combobox", { name: "Mwanza Clinic is supplied by" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringMatching(/^Central Store · /),
      expect.stringMatching(/^North Store · /),
    ]);
    fireEvent.click(screen.getByRole("option", { name: /North Store/ }));
    expect(
      screen.getByRole("button", { name: "Remove supply from North Store" }),
    ).toBeInTheDocument();
  });

  it("removing a location removes its connections", () => {
    act(() => {
      addChain();
    });
    render(<DemoApp />);
    openLocation("Central Store");
    fireEvent.click(screen.getByRole("button", { name: /Delete location/ }));
    expect(screen.queryByRole("button", { name: /Remove connection from/ })).toBeNull();
  });

  it("has a delete bin on every row, and no unexplained link count", () => {
    act(() => {
      addChain();
    });
    render(<DemoApp />);
    const list = screen.getByRole("region", { name: /Locations/ });
    for (const name of ["Dar Port", "Central Store", "Mwanza Clinic"]) {
      expect(within(list).getByRole("button", { name: `Delete ${name}` })).toBeInTheDocument();
    }
    // The old "—1" (number of links) is gone from the rows.
    expect(list.textContent).not.toMatch(/—\d/);

    // One click deletes the site and its links, without opening it first.
    fireEvent.click(within(list).getByRole("button", { name: "Delete Central Store" }));
    expect(within(list).queryByRole("button", { name: /^Central Store/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove connection from/ })).toBeNull();
  });

  it("offers to undo a deletion, which puts the site and its links back exactly", () => {
    act(() => {
      addChain();
    });
    const before = window.localStorage.getItem(STORAGE_KEY);
    render(<DemoApp />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Central Store" }));
    const toast = screen.getByText(/^Deleted/).closest<HTMLElement>('[role="status"]')!;
    expect(toast).toHaveTextContent("Deleted Central Store and 2 links");
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    const list = screen.getByRole("region", { name: /Locations/ });
    expect(within(list).getByRole("button", { name: /^Central Store/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Remove connection from/ })).toHaveLength(2);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(screen.queryByText(/Deleted Central Store/)).toBeNull();
  });

  it("lets the undo offer lapse after a few seconds", () => {
    vi.useFakeTimers();
    try {
      act(() => {
        addLocation("clinic", "Mwanza Clinic");
      });
      render(<DemoApp />);
      fireEvent.click(screen.getByRole("button", { name: "Delete Mwanza Clinic" }));
      expect(screen.getByText(/Deleted/)).toHaveTextContent("Deleted Mwanza Clinic");
      act(() => {
        vi.advanceTimersByTime(8000);
      });
      expect(screen.queryByText(/Deleted/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("working hours", () => {
  function Harness({ onChange }: { onChange?: (h: WeeklyHours) => void }) {
    const [hours, setHours] = useState(() => cloneHours(DEFAULT_HOURS));
    return (
      <HoursEditor
        value={hours}
        onChange={(h) => {
          setHours(h);
          onChange?.(h);
        }}
      />
    );
  }

  it("opens a closed day with the previous day's hours and edits times", () => {
    const changes: WeeklyHours[] = [];
    render(<Harness onChange={(h) => changes.push(h)} />);

    const sat = screen.getByRole("switch", { name: "Open on Sat" });
    expect(sat).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sat);
    expect(changes.at(-1)?.sat).toEqual([{ open: 540, close: 1020 }]);

    fireEvent.click(screen.getByRole("combobox", { name: "Sat closes" }));
    fireEvent.click(screen.getByRole("option", { name: "13:00" }));
    expect(changes.at(-1)?.sat).toEqual([{ open: 540, close: 780 }]);
  });

  it("marks closing times before opening as next-day, and applies presets", () => {
    const changes: WeeklyHours[] = [];
    render(<Harness onChange={(h) => changes.push(h)} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Mon closes" }));
    fireEvent.click(screen.getByRole("option", { name: "02:00 +1" }));
    expect(changes.at(-1)?.mon).toEqual([{ open: 540, close: 120 }]);

    fireEvent.click(screen.getByRole("button", { name: "24/7" }));
    expect(changes.at(-1)?.sun).toEqual([{ open: 0, close: 1440 }]);
  });

  it("edits a saved clinic's hours", () => {
    act(() => {
      addLocation("clinic", "Mwanza Clinic");
    });
    function Hours() {
      return <output>{JSON.stringify(useDemoState().locations[0]?.hours?.sat)}</output>;
    }
    render(
      <>
        <DemoApp />
        <Hours />
      </>,
    );
    openLocation("Mwanza Clinic");
    expect(screen.getByText("Mon–Fri 09:00–17:00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("switch", { name: "Open on Sat" }));
    fireEvent.click(screen.getByRole("button", { name: "Save hours" }));

    expect(screen.getByText("Mon–Sat 09:00–17:00")).toBeInTheDocument();
    expect(screen.getByText('[{"open":540,"close":1020}]')).toBeInTheDocument();
  });
});

describe("Select", () => {
  function Harness() {
    const [value, setValue] = useState("a");
    return (
      <Select
        label="Fruit"
        value={value}
        onChange={setValue}
        options={[
          { value: "a", label: "Apple" },
          { value: "b", label: "Banana" },
          { value: "c", label: "Cherry" },
        ]}
      />
    );
  }

  it("supports arrow keys, Enter, Escape, and typeahead", () => {
    render(<Harness />);
    const button = screen.getByRole("combobox", { name: "Fruit" });
    expect(button).toHaveTextContent("Apple");

    fireEvent.keyDown(button, { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(button).toHaveTextContent("Banana");
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "c" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" });
    expect(button).toHaveTextContent("Cherry");

    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(button).toHaveTextContent("Cherry");
  });
});

describe("AnalysisText", () => {
  it("renders Gemini's Markdown as headings, lists, and emphasis, never as raw symbols", () => {
    render(
      <AnalysisText
        text={[
          "### Why these sites",
          "",
          "*   **Central Store:** the main hub.",
          "*   Mwanza Clinic: serves **48,000** people.",
          "",
          "---",
          "",
          "1. Measure wait times.",
          "2. Run a `pilot`.",
          "",
          "<b>not html</b>",
        ].join("\n")}
      />,
    );
    expect(screen.getByRole("heading", { name: "Why these sites" })).toBeInTheDocument();
    const [bullets, steps] = screen.getAllByRole("list");
    expect(within(bullets!).getAllByRole("listitem")).toHaveLength(2);
    expect(within(steps!).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Central Store:")).toHaveClass("text-white", "font-semibold");
    expect(screen.getByText("48,000")).toHaveClass("text-aqua", "font-semibold");
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.getByText("<b>not html</b>")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/###|\*\*/);
  });
});

describe("adding a site from the map", () => {
  it("lets each type be dragged onto the map, or picked and then placed with a click", () => {
    const onPlace = vi.fn();
    const { rerender } = render(<LocationKinds locations={[]} onPlace={onPlace} />);
    const clinic = screen.getByRole("button", { name: /^Place a clinic on the map/ });
    expect(clinic).toHaveAttribute("draggable", "true");

    const setData = vi.fn();
    const setDragImage = vi.fn();
    fireEvent.dragStart(clinic, { dataTransfer: { setData, setDragImage, effectAllowed: "" } });
    expect(setData).toHaveBeenCalledWith(DRAG_KIND_TYPE, "clinic");
    // Only the kind's square follows the pointer (not the whole row), held by its centre.
    const [square, x, y] = setDragImage.mock.calls[0] as [HTMLElement, number, number];
    expect(square.textContent).toBe("C");
    expect(square.style.width).toBe("22px");
    expect([x, y]).toEqual([square.offsetWidth / 2, square.offsetHeight / 2]);

    fireEvent.click(clinic);
    expect(onPlace).toHaveBeenLastCalledWith("clinic");
    rerender(<LocationKinds locations={[]} placing="clinic" onPlace={onPlace} />);
    expect(clinic).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(clinic); // Clicking it again cancels.
    expect(onPlace).toHaveBeenLastCalledWith(null);
  });

  it("isn't draggable when the map isn't available", () => {
    render(<LocationKinds locations={[]} />);
    expect(screen.queryByRole("button", { name: /^Place a/ })).toBeNull();
  });

  it("opens the add form at the exact dropped point, and saves it there with its details", () => {
    const onAdded = vi.fn();
    const onDropCleared = vi.fn();
    const dropped = {
      kind: "clinic" as const,
      lat: 9.40751,
      lng: -0.85334,
      name: "Clinic 1",
      nonce: 1,
    };
    render(
      <AddLocationForm
        searchAvailable
        dropped={dropped}
        onAdded={onAdded}
        onDropCleared={onDropCleared}
      />,
    );
    expect(screen.getByText("Dropped on the map")).toBeInTheDocument();
    expect(screen.getByText("9.4075° N, 0.8533° W")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Clinic 1");
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveTextContent("Clinic");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Tamale North Clinic" } });
    fireEvent.change(screen.getByLabelText(/Population served/i), {
      target: { value: "25000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add to map/ }));

    function Saved() {
      return <output data-testid="saved">{JSON.stringify(useDemoState().locations)}</output>;
    }
    render(<Saved />);
    const [site] = JSON.parse(screen.getByTestId("saved").textContent ?? "[]");
    expect(site).toMatchObject({
      name: "Tamale North Clinic",
      kind: "clinic",
      lat: 9.40751, // exactly where it was dropped
      lng: -0.85334,
      address: "9.4075° N, 0.8533° W",
      population: 25000,
      gridPower: { from: 8, until: 16 },
    });
    expect(site.placeId).toBeUndefined();
    expect(onAdded).toHaveBeenCalledWith(site.id);
    expect(onDropCleared).toHaveBeenCalled();
  });
});

describe("grid power: no power at all", () => {
  function Field({ initial }: { initial: GridPower }) {
    const [value, setValue] = useState<GridPower>(initial);
    return (
      <>
        <GridPowerField value={value} hours={cloneHours(DEFAULT_HOURS)} onChange={setValue} />
        <output data-testid="power">{JSON.stringify(value)}</output>
      </>
    );
  }
  const power = () => JSON.parse(screen.getByTestId("power").textContent ?? "null");
  const box = () => screen.getByRole("checkbox", { name: "No grid power at all" });

  it("ticks to give the site no power, and unticks back to its last hours", () => {
    render(<Field initial={{ from: 6, until: 14 }} />);
    expect(box()).not.toBeChecked();
    fireEvent.click(box());
    expect(power()).toEqual({ from: 6, until: 6 });
    expect(box()).toBeChecked();
    expect(
      screen.getByText(/No grid power at all, so it can't take in medicines today/),
    ).toBeInTheDocument();
    fireEvent.click(box());
    expect(power()).toEqual({ from: 6, until: 14 });
  });

  it("ticks itself when the power goes off at the time it comes on", () => {
    render(<Field initial={{ from: 6, until: 14 }} />);
    pick("Power goes off", "06:00");
    expect(power()).toEqual({ from: 6, until: 6 });
    expect(box()).toBeChecked();
    pick("Power goes off", "10:00");
    expect(box()).not.toBeChecked();
  });

  it("can be ticked from a reliable grid", () => {
    render(<Field initial={null} />);
    fireEvent.click(box());
    expect(power()).toEqual({ from: 8, until: 8 });
    expect(box()).toBeChecked();
  });
});
