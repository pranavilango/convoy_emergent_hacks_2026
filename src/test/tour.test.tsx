import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DemoApp } from "@/components/demo/demo-app";
import { TOUR_STOPS } from "@/components/demo/guided-tour";
import { __resetDemoStore } from "@/lib/demo/store";
import { __resetTour, TOUR_STORAGE_KEY } from "@/lib/demo/tour";

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
  act(() => {
    __resetDemoStore();
    __resetTour();
  });
});

const tooltip = () => screen.queryByRole("dialog");
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("the demo's guided tour", () => {
  it("opens by itself on the first visit, beside the page rather than over it", () => {
    render(<DemoApp />);
    const dialog = screen.getByRole("dialog", { name: "Welcome to Convoy" });
    // A tooltip, not a modal: no backdrop, and the rest of the page keeps working.
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(screen.getByRole("button", { name: "Load Ghana sample network" })).toBeEnabled();
    expect(document.querySelector(".fixed.inset-0")).toBeNull();
  });

  it("can be skipped, and then stays closed on later visits", () => {
    const { unmount } = render(<DemoApp />);
    click("Skip");
    expect(tooltip()).toBeNull();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe("seen");

    unmount();
    act(() => __resetTour());
    render(<DemoApp />);
    expect(tooltip()).toBeNull();
  });

  it("steps through every feature, each one really on the page, budget first", () => {
    const { container } = render(<DemoApp />);
    expect(TOUR_STOPS.map((s) => s.target)).toEqual([
      "tour",
      "budget",
      "add",
      "kinds",
      "locations",
      "connections",
      "map",
      "analysis",
      "sample",
    ]);
    TOUR_STOPS.forEach((stop, i) => {
      const dialog = screen.getByRole("dialog", { name: stop.title });
      expect(within(dialog).getByText(stop.body)).toBeInTheDocument();
      expect(within(dialog).getByText(`0${i + 1} / 0${TOUR_STOPS.length}`)).toBeInTheDocument();
      expect(container.querySelector(`[data-tour="${stop.target}"]`)).not.toBeNull();
      if (i < TOUR_STOPS.length - 1) click("Next →");
    });

    click("Back");
    expect(screen.getByRole("dialog", { name: "Analyze" })).toBeInTheDocument();
    click("Next →");
    click("Done");
    expect(tooltip()).toBeNull();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe("seen");
  });

  it("steps with the arrow keys and closes on Escape", () => {
    render(<DemoApp />);
    fireEvent.keyDown(tooltip()!, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: "Start with the budget" })).toBeInTheDocument();
    fireEvent.keyDown(tooltip()!, { key: "ArrowLeft" });
    expect(screen.getByRole("dialog", { name: "Welcome to Convoy" })).toBeInTheDocument();
    fireEvent.keyDown(tooltip()!, { key: "Escape" });
    expect(tooltip()).toBeNull();
  });

  it("replays from the header's Tour button", () => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "seen");
    render(<DemoApp />);
    expect(tooltip()).toBeNull();
    click("Tour");
    expect(screen.getByRole("dialog", { name: "Welcome to Convoy" })).toBeInTheDocument();
  });
});

describe("demo page layout", () => {
  it("keeps the editor's positioned bits inside it, so the window never grows below the page", () => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "seen");
    const { container } = render(<DemoApp />);
    expect(container.querySelector(".demo-shell")).toHaveClass("md:h-dvh", "md:overflow-hidden");
    expect(screen.getByLabelText("Network editor")).toHaveClass("relative", "md:overflow-y-auto");
  });
});
