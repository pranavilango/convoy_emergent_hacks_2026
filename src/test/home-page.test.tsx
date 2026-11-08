import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home, { metadata } from "@/app/page";

describe("Home page", () => {
  it("renders the hero, every section anchor, all six inputs, and what you get", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { level: 1, name: "Convoy" })).toBeInTheDocument();
    for (const id of ["problem", "solution", "how", "results"]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    for (const input of [
      "Ports",
      "Warehouses",
      "Clinics",
      "Working hours",
      "Grid power",
      "Budget",
    ]) {
      expect(screen.getAllByText(input).length).toBeGreaterThan(0);
    }
    // Only what the product does: each output is in the hero and in "What you get".
    for (const output of [
      "Solar priority",
      "Grid gaps",
      "Delivery waits",
      "Budget curve",
      "Explained plans",
    ]) {
      expect(screen.getAllByText(output)).toHaveLength(2);
    }
    expect(document.body.textContent).not.toMatch(/Panel sizing|Battery backup|batteries/);
    expect(screen.queryByText(/Try it on the Ghana sample network/)).toBeNull();
    expect(screen.getByText("Power Planner")).toBeInTheDocument();
    // No label starts with an underscore ("06 What you get", not "_06 …").
    const texts = [...document.body.querySelectorAll("*")]
      .flatMap((el) => [...el.childNodes])
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent?.trim() ?? "");
    expect(texts.filter((t) => t.startsWith("_"))).toEqual([]);
    expect(screen.getByAltText(/^Earth at night/)).toBeInTheDocument();
  });

  it("powers on only the hero headline at load, Convoy first, all within 1.5s", () => {
    const { container } = render(<Home />);
    const lit = [...container.querySelectorAll<HTMLElement>(".flicker-in")];
    const headline = screen.getByRole("heading", { level: 1 }).firstElementChild as HTMLElement;
    expect(lit).toContain(headline);
    expect(lit).toContain(screen.getByText("Power Planner"));
    expect(lit).toHaveLength(2 + 5); // Convoy, Power Planner, and the five outputs

    const ends = lit.map(
      (el) => parseFloat(el.style.animationDelay) + parseFloat(el.style.animationDuration),
    );
    expect(Math.max(...ends)).toBeLessThanOrEqual(1.5);
    const starts = lit.map((el) => parseFloat(el.style.animationDelay));
    expect(parseFloat(headline.style.animationDelay)).toBe(Math.min(...starts));
    expect(new Set(starts).size).toBe(starts.length);

    // The navbar logo stays steady and is in the brand accent.
    const logo = container.querySelector("header svg");
    expect(logo?.closest(".flicker-in")).toBeNull();
    expect(logo).toHaveClass("fill-brand", "stroke-brand");
  });

  it("flickers on the kilowatt line and the footer as they scroll into view", () => {
    const { container } = render(<Home />);
    expect([...container.querySelectorAll(".power-on-view")].map((el) => el.textContent)).toEqual([
      "Every kilowatt counts.",
      "Power care.",
    ]);
  });

  it("sets the Earth photo up to turn about the planet's centre as it scrolls", () => {
    render(<Home />);
    const spinner = screen.getByAltText(/^Earth at night/).closest(".earth-spin");
    expect(spinner).not.toBeNull();
    expect(spinner?.closest(".earth-view")).not.toBeNull();
  });

  it("sets its own title rather than inheriting the layout default", () => {
    expect(metadata.title).toEqual({
      absolute: "Convoy — Solar power planner for medical supply networks",
    });
  });
});
