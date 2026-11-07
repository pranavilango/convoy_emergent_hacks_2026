import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home, { metadata } from "@/app/page";

describe("Home page", () => {
  it("renders the hero, every section anchor, and all four inputs", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { level: 1, name: "Convoy" })).toBeInTheDocument();
    for (const id of ["problem", "solution", "how"]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    for (const input of ["Locations", "Working hours", "Order sizes", "Vehicles"]) {
      expect(screen.getAllByText(input).length).toBeGreaterThan(0);
    }
    expect(
      screen.getByAltText("City lights connected by glowing delivery routes"),
    ).toBeInTheDocument();
  });

  it("sets its own title rather than inheriting the layout default", () => {
    expect(metadata.title).toEqual({ absolute: "Convoy — Growth planner for small businesses" });
  });
});
