import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DemoApp } from "@/components/demo/demo-app";
import { Select } from "@/components/demo/select";
import { __resetDemoStore, demoActions, STORAGE_KEY } from "@/lib/demo/store";

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

function addLocation(typeId: string, name: string) {
  return demoActions.addLocation({ name, address: `${name} address`, lat: 1, lng: 2, typeId });
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
