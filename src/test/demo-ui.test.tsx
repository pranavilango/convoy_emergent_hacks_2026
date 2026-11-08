import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalysisText } from "@/components/demo/analysis-text";
import { DemoApp } from "@/components/demo/demo-app";
import { Select } from "@/components/demo/select";
import { HoursEditor } from "@/components/demo/hours-editor";
import { cloneHours, DEFAULT_HOURS, type WeeklyHours } from "@/lib/demo/hours";
import type { LocationKind } from "@/lib/demo/kinds";
import { __resetDemoStore, demoActions, STORAGE_KEY, useDemoState } from "@/lib/demo/store";

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
  act(() => __resetDemoStore());
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
    expect(screen.getByRole("link", { name: "← Back to site" })).toHaveAttribute("href", "/");
  });
});

describe("solar allocation analysis", () => {
  it("only enables Analyze when every location kind exists and shows the returned analysis", async () => {
    const allocation = {
      selected: ["clinic", "warehouse"],
      n: 2,
      solver: "exact",
      baseline_weighted_hours: 21.64,
      optimized_weighted_hours: 11.54,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ allocation, analysis: "These sites reduce modeled delivery times." }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<DemoApp />);

    const analyzeButton = screen.getByRole("button", { name: "Analyze" });
    expect(analyzeButton).toBeDisabled();

    act(() => {
      addLocation("port", "Dar Port");
      addLocation("warehouse", "Central Store");
    });
    expect(analyzeButton).toBeDisabled();

    act(() => {
      addLocation("clinic", "Mwanza Clinic");
    });
    act(() => {
      demoActions.setUnitCost(1);
      demoActions.setTotalBudget(2);
    });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null").state.budget).toEqual({
      unitCost: 1,
      total: 2,
    });
    expect(analyzeButton).toBeEnabled();

    fireEvent.click(analyzeButton);
    expect(await screen.findByRole("dialog", { name: "Network analysis" })).toBeInTheDocument();
    expect(
      await screen.findByText("These sites reduce modeled delivery times."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Convoy selected 2 of 2 requested solar units/)).toBeInTheDocument();
    // The popup never names the search strategy (exact vs. greedy).
    expect(screen.getByRole("dialog").textContent).not.toMatch(/solver|exact|greedy/i);
    expect(screen.getByText("Mwanza Clinic")).toBeInTheDocument();
    expect(screen.getByText("Central Store")).toBeInTheDocument();
    expect(screen.getByText(/21\.64 h before upgrades/)).toBeInTheDocument();
    expect(screen.getByText(/11\.54 h after upgrades/)).toBeInTheDocument();
    expect(screen.getByText("10.10 h")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(sent.network.locations.map((l: { name: string }) => l.name)).toContain("Mwanza Clinic");
    // The demo's details go along: hours, clinic population.
    expect(sent.network.locations).toContainEqual(
      expect.objectContaining({
        name: "Mwanza Clinic",
        population: 1200,
        hours: expect.objectContaining({ mon: [{ open: 540, close: 1020 }], sat: [], sun: [] }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close network analysis" }));
    expect(screen.queryByRole("dialog")).toBeNull();
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

    fireEvent.click(screen.getByRole("button", { name: "Remove location" }));
    expect(screen.queryByText("Mwanza Clinic")).toBeNull();
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
      screen.getByRole("button", { name: /Remove location \+ 2 connections/ }),
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
    fireEvent.click(screen.getByRole("button", { name: /Remove location/ }));
    expect(screen.queryByRole("button", { name: /Remove connection from/ })).toBeNull();
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
          "*   Mwanza Clinic serves *48,000* people.",
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
    expect(screen.getByText("Central Store:").tagName).toBe("STRONG");
    expect(screen.getByText("48,000").tagName).toBe("EM");
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.getByText("<b>not html</b>")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/###|\*\*/);
  });
});
