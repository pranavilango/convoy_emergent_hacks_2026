import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DemoApp } from "@/components/demo/demo-app";
import { Select } from "@/components/demo/select";
import { HoursEditor } from "@/components/demo/hours-editor";
import { cloneHours, DEFAULT_HOURS, type WeeklyHours } from "@/lib/demo/hours";
import { __resetDemoStore, demoActions, STORAGE_KEY, useDemoState } from "@/lib/demo/store";

// The Maps SDK can't run in jsdom. These tests cover the no-key path and pure UI; the map itself
// is exercised manually against the real API.
vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => children,
  Map: () => null,
  AdvancedMarker: () => null,
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

function addLocation(typeId: string, name: string) {
  return demoActions.addLocation({
    name,
    address: `${name} address`,
    lat: 1,
    lng: 2,
    typeId,
    hours: cloneHours(DEFAULT_HOURS),
  });
}

describe("demo store persistence", () => {
  it("saves to localStorage and loads it back", () => {
    act(() => {
      addLocation("factory", "Plant");
    });
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    expect(saved.version).toBe(1);
    expect(saved.state.locations[0].name).toBe("Plant");

    act(() => __resetDemoStore());
    render(<DemoApp />);
    expect(screen.getByText("Plant")).toBeInTheDocument();
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
    // Type management still works without the map.
    expect(screen.getByRole("button", { name: "Edit Factory" })).toBeInTheDocument();
  });

  it("links back to the landing page", () => {
    render(<DemoApp />);
    expect(screen.getByRole("link", { name: "← Back to site" })).toHaveAttribute("href", "/");
  });
});

describe("location types", () => {
  it("creates a type", () => {
    render(<DemoApp />);
    fireEvent.click(screen.getByRole("button", { name: "+ New type" }));
    fireEvent.change(screen.getByLabelText("Type name"), { target: { value: "Dark kitchen" } });
    fireEvent.click(screen.getByRole("button", { name: "Add type" }));
    expect(screen.getByRole("button", { name: "Edit Dark kitchen" })).toBeInTheDocument();
  });

  it("shows an error for a duplicate name and doesn't save", () => {
    render(<DemoApp />);
    fireEvent.click(screen.getByRole("button", { name: "+ New type" }));
    fireEvent.change(screen.getByLabelText("Type name"), { target: { value: "warehouse" } });
    fireEvent.click(screen.getByRole("button", { name: "Add type" }));
    expect(screen.getByText(/already exists/)).toBeInTheDocument();
  });

  it("moves locations to another type when deleting a type in use", () => {
    act(() => {
      addLocation("factory", "Plant A");
      addLocation("factory", "Plant B");
    });
    render(<DemoApp />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Factory" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete type" }));
    expect(screen.getByText(/2 locations use/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move & delete type" }));

    expect(screen.queryByRole("button", { name: "Edit Factory" })).toBeNull();
    const list = screen.getByRole("region", { name: /Locations/ });
    expect(within(list).getAllByText("Warehouse")).toHaveLength(2);
  });

  it("can delete a type together with its locations", () => {
    act(() => {
      addLocation("factory", "Plant A");
    });
    render(<DemoApp />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Factory" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete type" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete type + 1" }));
    expect(screen.queryByText("Plant A")).toBeNull();
  });
});

describe("location list", () => {
  it("expands a location to change its type, and removes it", () => {
    act(() => {
      addLocation("factory", "Plant A");
    });
    render(<DemoApp />);
    fireEvent.click(screen.getByRole("button", { name: /Plant A/ }));

    fireEvent.click(screen.getByRole("combobox", { name: "Type" }));
    fireEvent.click(screen.getByRole("option", { name: /Retail store/ }));
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveTextContent("Retail store");
    expect(screen.getByRole("button", { name: /Plant A/ })).toHaveTextContent("Retail store");

    fireEvent.click(screen.getByRole("button", { name: "Remove location" }));
    expect(screen.queryByText("Plant A")).toBeNull();
  });
});

describe("location connections", () => {
  function pick(label: string, option: string) {
    fireEvent.click(screen.getByRole("combobox", { name: label }));
    fireEvent.click(screen.getByRole("option", { name: new RegExp(option) }));
  }

  it("connects one location to another from the panel, and removes it", () => {
    act(() => {
      addLocation("factory", "Plant A");
      addLocation("warehouse", "Depot B");
    });
    render(<DemoApp />);

    const add = screen.getByRole("button", { name: /Add connection/ });
    expect(add).toBeDisabled();
    pick("From", "Plant A");
    pick("To", "Depot B");
    fireEvent.click(add);

    const remove = screen.getByRole("button", {
      name: "Remove connection from Plant A to Depot B",
    });
    // Plant A → Depot B exists, so it isn't offered again…
    pick("From", "Plant A");
    expect(screen.getByRole("combobox", { name: "To" })).toBeDisabled();
    // …but the reverse direction still is.
    pick("From", "Depot B");
    pick("To", "Plant A");
    fireEvent.click(add);
    expect(
      screen.getByRole("button", { name: "Remove connection from Depot B to Plant A" }),
    ).toBeInTheDocument();

    fireEvent.click(remove);
    expect(
      screen.queryByRole("button", { name: "Remove connection from Plant A to Depot B" }),
    ).toBeNull();
  });

  it("shows outgoing and incoming connections in a location's expanded row", () => {
    act(() => {
      const a = addLocation("factory", "Plant A");
      const b = addLocation("warehouse", "Depot B");
      const c = addLocation("retail-store", "Shop C");
      demoActions.connectLocations(a, b);
      demoActions.connectLocations(c, a);
    });
    render(<DemoApp />);
    openLocation("Plant A");

    expect(
      screen.getByRole("button", { name: "Remove connection to Depot B" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove connection from Shop C" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Remove location \+ 2 connections/ }),
    ).toBeInTheDocument();

    // Shop C → Plant A exists, but Plant A → Shop C doesn't, so it's offered.
    pick("Connect Plant A to", "Shop C");
    expect(screen.getByRole("button", { name: "Remove connection to Shop C" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove connection to Depot B" }));
    expect(screen.queryByRole("button", { name: "Remove connection to Depot B" })).toBeNull();
  });

  it("removing a location removes its connections", () => {
    act(() => {
      const a = addLocation("factory", "Plant A");
      const b = addLocation("warehouse", "Depot B");
      demoActions.connectLocations(a, b);
    });
    render(<DemoApp />);
    openLocation("Plant A");
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

  it("edits a saved location's hours", () => {
    act(() => {
      addLocation("factory", "Plant A");
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
    openLocation("Plant A");
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
