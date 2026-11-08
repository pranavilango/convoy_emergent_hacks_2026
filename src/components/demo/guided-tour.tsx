"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

import { Button } from "./controls";

type Side = "right" | "left" | "below" | "above";

/** One tooltip: it points at the element marked `data-tour="<target>"`. */
export type TourStop = {
  target: string;
  title: string;
  body: string;
  /** Which side of the target the tooltip prefers, or "inside" it (for the big map). */
  place: Side | "inside";
  /** False for a target that already has its own accent outline (the header's Tour button). */
  outline?: false;
};

export const TOUR_STOPS: readonly TourStop[] = [
  {
    target: "tour",
    place: "below",
    outline: false,
    title: "Welcome to Convoy",
    body: "Convoy works out which warehouses and clinics should get solar first, so medicines keep arriving through power cuts. This quick tour shows each part. Replay it any time from here.",
  },
  {
    target: "budget",
    place: "right",
    title: "Start with the budget",
    body: "This is the main limit. The cost of one solar unit and the total budget decide how many sites can get solar.",
  },
  {
    target: "add",
    place: "right",
    title: "Add sites",
    body: "Search a real address and add it as a port, warehouse, or clinic. Warehouses and clinics also get their staffed hours and the hours the grid is on.",
  },
  {
    target: "kinds",
    place: "right",
    title: "Drag sites onto the map",
    body: "Or drag a type onto the map to drop a site exactly there (or click a type, then the map), and fill in its details. Supplies flow port → warehouse → clinic.",
  },
  {
    target: "locations",
    place: "right",
    title: "Your sites",
    body: "Open any site to change its hours, grid power, or population.",
  },
  {
    target: "connections",
    place: "right",
    title: "Supply links",
    body: "Add who supplies whom here, or select a port or warehouse on the map and press Connect.",
  },
  {
    target: "map",
    place: "inside",
    title: "The map",
    body: "Your network as you build it. After you analyze, the sites chosen for solar glow blue.",
  },
  {
    target: "analysis",
    place: "right",
    title: "Analyze",
    body: "Convoy's optimizer places your solar units where they get medicines from the port to clinics soonest, counting bigger clinics more, and Gemini explains why. Anything missing is listed here first.",
  },
  {
    target: "sample",
    place: "above",
    title: "No data? Start here",
    body: "Load a ready-made Ghana supply network, then press Analyze to see a full plan.",
  },
];

/** Gap between the target and the tooltip, and the tooltip's minimum distance from the edges. */
const GAP = 14;
const EDGE = 12;
/** Below this width the tooltip docks to the top or bottom of the screen (the panel is full width). */
const DOCK_BELOW = 768;

type Box = { top: number; left: number; width: number; height: number };
type Layout = {
  /** A thin line around the part being explained, cut to what's on screen. */
  outline: Box | null;
  card: { top: number; left: number } | { dock: "top" | "bottom" };
  /** The little pointer on the tooltip's edge, `at` pixels along that edge. */
  caret: { side: Side; at: number } | null;
};

/** A layout for one stop, and whether the scroll to that stop has finished. */
type Placed = Layout & { stop: number; settled: boolean };

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));

/** Room left above a part when the tour scrolls it to the top. */
const SCROLL_MARGIN = 24;

type ScrollPlan = {
  /** The editor column, or null for the page itself (phones). */
  scroller: HTMLElement | null;
  from: number;
  to: number;
  duration: number;
};

const scrollTopOf = (scroller: HTMLElement | null) =>
  scroller ? scroller.scrollTop : window.scrollY;

function setScrollTop(scroller: HTMLElement | null, top: number) {
  if (scroller) scroller.scrollTop = top;
  else window.scrollTo(0, top);
}

/** Slow at both ends: the scroll eases out of where it was and settles gently. */
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * How to bring a part to the top of the view: the editor column on desktop, the page on phones.
 * Null when nothing needs to move (the header, the map, the floating sample button).
 */
function planScroll(target: HTMLElement, reduceMotion: boolean): ScrollPlan | null {
  if (getComputedStyle(target).position === "fixed") return null;
  const aside = target.closest("aside");
  const asideScrolls =
    aside !== null &&
    /(auto|scroll)/.test(getComputedStyle(aside).overflowY) &&
    aside.scrollHeight > aside.clientHeight;
  if (!asideScrolls && window.innerWidth >= DOCK_BELOW) return null;
  const scroller = asideScrolls ? aside : null;
  const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
  const max = scroller
    ? scroller.scrollHeight - scroller.clientHeight
    : document.documentElement.scrollHeight - window.innerHeight;
  const from = scrollTopOf(scroller);
  const to = clamp(
    from + target.getBoundingClientRect().top - viewTop - SCROLL_MARGIN,
    0,
    Math.max(0, max),
  );
  const distance = Math.abs(to - from);
  if (distance < 1) return null;
  // Longer trips take a little longer, but never drag: 0.6 s to 1 s.
  const duration = reduceMotion ? 0 : clamp(450 + distance * 0.5, 600, 1000);
  return { scroller, from, to, duration };
}

function computeLayout(
  target: HTMLElement | null,
  card: HTMLElement | null,
  place: TourStop["place"],
  /** How much further the target will scroll up: lay out for where it's going to be. */
  shift = 0,
): Layout | null {
  if (!target || !card) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const raw = target.getBoundingClientRect();
  const r = { top: raw.top - shift, bottom: raw.bottom - shift, left: raw.left, right: raw.right };
  // Parts of the editor are only visible inside its scrolling column.
  const clip = target.closest("aside")?.getBoundingClientRect() ?? {
    top: 0,
    left: 0,
    right: vw,
    bottom: vh,
  };
  const v = {
    top: Math.max(r.top, clip.top),
    bottom: Math.min(r.bottom, clip.bottom),
    left: Math.max(r.left, clip.left),
    right: Math.min(r.right, clip.right),
  };
  const shown = v.bottom > v.top && v.right > v.left;
  // A little room around small parts; the map already fills its area, so its line sits inside.
  const pad = place === "inside" ? -2 : 6;
  const outlineTop = Math.max(r.top - pad, clip.top + 2);
  const outlineLeft = Math.max(r.left - pad, clip.left + 2);
  const outline = shown
    ? {
        top: outlineTop,
        left: outlineLeft,
        width: Math.min(r.right + pad, clip.right - 2) - outlineLeft,
        height: Math.min(r.bottom + pad, clip.bottom - 2) - outlineTop,
      }
    : null;

  if (vw < DOCK_BELOW) {
    // Dock away from the target so the tooltip never covers it.
    return {
      outline,
      card: { dock: (r.top + r.bottom) / 2 > vh / 2 ? "top" : "bottom" },
      caret: null,
    };
  }

  const w = card.offsetWidth;
  const h = card.offsetHeight;
  // Point at the target's heading (its top line) when it's on screen, else its middle.
  const anchorY = shown ? clamp(v.top + 12, v.top, v.bottom) : vh / 2;
  const anchorX = shown ? (v.left + v.right) / 2 : vw / 2;
  const fitTop = (top: number) => clamp(top, EDGE, Math.max(EDGE, vh - h - EDGE));
  const fitLeft = (left: number) => clamp(left, EDGE, Math.max(EDGE, vw - w - EDGE));
  const caretAt = (n: number, size: number) => clamp(n, 14, size - 14);

  const attempts: Record<Side, () => Layout | null> = {
    right: () => {
      if (v.right + GAP + w + EDGE > vw) return null;
      const top = fitTop(anchorY - 22);
      return {
        outline,
        card: { top, left: v.right + GAP },
        caret: { side: "left", at: caretAt(anchorY - top, h) },
      };
    },
    left: () => {
      if (v.left - GAP - w < EDGE) return null;
      const top = fitTop(anchorY - 22);
      return {
        outline,
        card: { top, left: v.left - GAP - w },
        caret: { side: "right", at: caretAt(anchorY - top, h) },
      };
    },
    below: () => {
      if (v.bottom + GAP + h + EDGE > vh) return null;
      const left = fitLeft(anchorX - w / 2);
      return {
        outline,
        card: { top: v.bottom + GAP, left },
        caret: { side: "above", at: caretAt(anchorX - left, w) },
      };
    },
    above: () => {
      if (v.top - GAP - h < EDGE) return null;
      const left = fitLeft(anchorX - w / 2);
      return {
        outline,
        card: { top: v.top - GAP - h, left },
        caret: { side: "below", at: caretAt(anchorX - left, w) },
      };
    },
  };

  if (place !== "inside") {
    for (const side of [place, "right", "below", "above", "left"] as const) {
      const layout = attempts[side]();
      if (layout) return layout;
    }
  }
  return {
    outline,
    card: { top: fitTop(v.top + 16), left: fitLeft(v.left + 16) },
    caret: null,
  };
}

function sameLayout(a: Placed | null, b: Placed | null) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Where the caret sits for each edge of the tooltip, and which two borders draw its point. */
const CARET: Record<Side, { style: (at: number) => CSSProperties; border: string }> = {
  // `side` is the tooltip edge the caret is on; "left" means the target is to the left.
  left: { style: (at) => ({ left: -5, top: at - 4 }), border: "border-b border-l" },
  right: { style: (at) => ({ right: -5, top: at - 4 }), border: "border-t border-r" },
  above: { style: (at) => ({ top: -5, left: at - 4 }), border: "border-t border-l" },
  below: { style: (at) => ({ bottom: -5, left: at - 4 }), border: "border-b border-r" },
};

/**
 * A skippable tooltip walkthrough. Each tooltip sits next to the part of the page it explains,
 * with a thin line around that part; the rest of the page stays as it is and keeps working.
 * Escape or "Skip" ends it; in a tooltip, the arrow keys step through it.
 */
export function GuidedTour({ onClose }: { /** Finished or skipped. */ onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [layout, setLayout] = useState<Placed | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const stop = TOUR_STOPS[index]!;
  const last = index === TOUR_STOPS.length - 1;
  const go = (to: number) => setIndex(clamp(to, 0, TOUR_STOPS.length - 1));

  // Glide the part into view (an eased scroll, not the browser's quick jump), place the tooltip
  // where the part will end up, then keep it beside the part as things scroll and resize.
  useEffect(() => {
    const target = document.querySelector<HTMLElement>(`[data-tour="${stop.target}"]`);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const plan = target ? planScroll(target, reduce) : null;
    const start = performance.now();
    let scrolling = plan !== null;
    let frame = 0;
    const follow = (now: number) => {
      let shift = 0;
      if (plan && scrolling) {
        const t = plan.duration > 0 ? clamp((now - start) / plan.duration, 0, 1) : 1;
        setScrollTop(plan.scroller, plan.from + (plan.to - plan.from) * easeInOutCubic(t));
        if (t >= 1) scrolling = false;
        else shift = plan.to - scrollTopOf(plan.scroller);
      }
      const next = computeLayout(target, cardRef.current, stop.place, shift);
      const placed = next && { ...next, stop: index, settled: !scrolling };
      setLayout((prev) => (sameLayout(prev, placed) ? prev : placed));
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [stop, index]);

  // Focus the tooltip's main button on each stop, without scrolling the page to it.
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, [index]);

  // Escape also skips when nothing in particular has focus (e.g. after clicking the map).
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        document.activeElement === document.body
      ) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowRight" && !last) {
      event.preventDefault();
      go(index + 1);
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      go(index - 1);
    }
  }

  const card = layout?.card;
  const docked = card && "dock" in card ? card.dock : null;
  const counter = `${String(index + 1).padStart(2, "0")} / ${String(TOUR_STOPS.length).padStart(2, "0")}`;

  return (
    <>
      {/* Drawn once the part has stopped moving, fading in (a new one for each stop). */}
      {layout?.outline && layout.stop === index && layout.settled && stop.outline !== false && (
        <div
          key={index}
          aria-hidden
          data-testid="tour-outline"
          className="pointer-events-none fixed z-40 rounded-sm border border-brand/70 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-500"
          style={layout.outline}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        onKeyDown={onKeyDown}
        className={cn(
          "fixed z-40 w-72 rounded-sm border border-brand/70 bg-background p-4 text-foreground shadow-[0_8px_30px_rgb(0_0_0/0.5)]",
          // Glides from one stop to the next.
          "transition-[top,left] duration-500 ease-out motion-reduce:transition-none",
          docked === "top" && "inset-x-3 top-3 w-auto",
          docked === "bottom" && "inset-x-3 bottom-3 w-auto",
          // Measured before it's shown, so it never flashes in the wrong place.
          layout === null && "opacity-0",
        )}
        style={card && !("dock" in card) ? { top: card.top, left: card.left } : undefined}
      >
        {layout?.caret && (
          <span
            aria-hidden
            className={cn(
              "absolute h-2 w-2 rotate-45 border-brand/70 bg-background",
              CARET[layout.caret.side].border,
            )}
            style={CARET[layout.caret.side].style(layout.caret.at)}
          />
        )}
        <div className="flex items-baseline justify-between font-mono text-[11px] uppercase tracking-wider">
          <span>
            <span className="text-brand">Tour</span> <span className="opacity-60">{counter}</span>
          </span>
          {!last && (
            <button
              type="button"
              onClick={onClose}
              className="opacity-60 underline-offset-4 outline-none hover:underline hover:opacity-100 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-foreground"
            >
              Skip
            </button>
          )}
        </div>
        <div
          key={index}
          className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
        >
          <h2 id="tour-title" className="mt-2 text-base font-medium tracking-[-0.01em]">
            {stop.title}
          </h2>
          <p id="tour-body" className="mt-1 text-sm leading-relaxed text-white/75">
            {stop.body}
          </p>
        </div>
        <div className="mt-3 flex items-center justify-end gap-3">
          {index > 0 && (
            <Button variant="ghost" size="sm" onClick={() => go(index - 1)}>
              Back
            </Button>
          )}
          <Button ref={nextRef} size="sm" onClick={() => (last ? onClose() : go(index + 1))}>
            {last ? "Done" : "Next →"}
          </Button>
        </div>
      </div>
    </>
  );
}
