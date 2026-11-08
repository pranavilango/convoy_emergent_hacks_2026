import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";

import earth from "@/assets/earth-network.jpg";
import { ConvoyMark } from "@/components/convoy-mark";
import { PowerOn } from "@/components/landing/power-on";

export const metadata: Metadata = {
  title: { absolute: "Convoy — Solar power planner for medical supply networks" },
  description:
    "Convoy allocates solar power across medical warehouses and clinics in low-resource regions.",
  openGraph: {
    title: "Convoy — Solar power planner for medical supply networks",
    description:
      "Map your ports, warehouses, and clinics. Convoy tells you where solar power protects the most care.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

/** What Convoy gives you: each is shown in the demo's analysis result. */
const outputs = [
  [
    "Solar priority",
    "The sites to equip first, picked across your whole network to fit your budget.",
  ],
  [
    "Grid gaps",
    "When each site can take in medicines today, staffed and powered, and the hours solar adds.",
  ],
  ["Delivery waits", "The average wait for supplies before and after, weighted by people served."],
  ["Budget curve", "What each extra solar unit buys, so you can see where funding pays off most."],
  [
    "Explained plans",
    "A plain-language reason for every choice, written by Gemini from the optimizer's numbers.",
  ],
] as const;

const inputs = [
  ["01", "Ports", "Air and sea entry points for supplies."],
  ["02", "Warehouses", "Where medicines are stored and kept cold."],
  ["03", "Clinics", "Where patients are treated, and how many people each serves."],
  ["04", "Working hours", "When each site is staffed to take in deliveries."],
  ["05", "Grid power", "The hours each site has electricity to keep medicines cold."],
  ["06", "Budget", "What one solar unit costs and how much money you have."],
] as const;

const problems = [
  ["Unreliable grid", "Outages spoil vaccines and insulin, and stop care after dark."],
  ["Scarce funding", "Budgets cover a few solar systems, never one for every site."],
  ["No clear priority", "Panels go to whoever asks first, not where they protect the most care."],
] as const;

/**
 * The hero's power-on sequence: "Convoy" lights first, then "Power Planner" and the outputs at
 * uneven moments, like lights on one weak grid coming back. All done in about 1.5s. Pair with
 * `.flicker-in`.
 */
function lightsOn(delay: number, duration = 0.9): CSSProperties {
  return { animationDelay: `${delay}s`, animationDuration: `${duration}s` };
}

/** When each output in the hero list lights up (deliberately out of order). */
const OUTPUT_DELAYS = [0.34, 0.52, 0.27, 0.6, 0.43];

function Arrow() {
  return <span className="font-mono text-xs text-white/50">↘</span>;
}

export default function Home() {
  return (
    <main className="landing bg-night font-display text-white">
      {/* Black at the top, deepening to the photo's navy so the Earth rises out of the page. */}
      <div className="bg-linear-to-b from-night from-40% to-night-navy">
        {/* Nav */}
        <header className="flex items-center justify-between border-b border-white/15 px-6 py-4 md:px-10">
          <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <ConvoyMark />
            Convoy
          </div>
          <nav className="hidden gap-8 text-sm text-white/75 md:flex">
            <a href="#problem" className="transition-colors hover:text-aqua">
              Problem
            </a>
            <a href="#solution" className="transition-colors hover:text-aqua">
              Solution
            </a>
            <a href="#how" className="transition-colors hover:text-aqua">
              How it works
            </a>
            <a href="#results" className="transition-colors hover:text-aqua">
              What you get
            </a>
          </nav>
          <Link
            href="/demo"
            className="rounded-sm bg-aqua px-4 py-2 text-sm font-medium text-night transition-colors hover:bg-white"
          >
            Try the demo
          </Link>
        </header>

        {/* Hero */}
        <section className="px-6 pb-16 pt-4 md:px-10">
          <div className="flex justify-between font-mono text-[11px] uppercase tracking-wider text-white/60">
            <span>_01</span>
            <span>Built for last-mile health</span>
          </div>

          <div className="mt-16 grid grid-cols-1 items-end gap-8 md:grid-cols-[1fr_auto]">
            <h1 className="text-[26vw] font-medium leading-[0.8] tracking-[-0.07em] text-aqua md:text-[19vw]">
              <span className="flicker-in" style={lightsOn(0, 1)}>
                Convoy
              </span>
            </h1>
            <ul className="space-y-1 pb-6 text-lg">
              {outputs.map(([o], i) => (
                <li
                  key={o}
                  className="flicker-in flex w-56 items-center justify-between"
                  style={lightsOn(OUTPUT_DELAYS[i] ?? 0.4)}
                >
                  {o} <Arrow />
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-6 grid grid-cols-1 items-end gap-8 md:grid-cols-[18rem_1fr]">
            <div className="text-sm">
              <p className="max-w-xs text-white/75">
                A solar power allocation planner for medical warehouses and clinics in low-resource
                regions.
              </p>
              <a
                href="#solution"
                className="mt-4 flex items-center justify-between border-b border-aqua/60 pb-1 text-aqua transition-colors hover:border-aqua"
              >
                Explore more <span>↗</span>
              </a>
            </div>
            <p className="text-5xl font-normal leading-[0.9] tracking-[-0.05em] md:text-right md:text-[7.5vw]">
              <span className="flicker-in" style={lightsOn(0.18)}>
                Power Planner
              </span>
            </p>
          </div>
        </section>
      </div>

      {/* Image: fades in from the hero's navy and back out to black, so it reads as part of the
          night rather than a band across the page. As it scrolls past, the planet turns: the
          photo rotates about the Earth's real centre (fitted from its horizon), so the horizon
          stays put while the land and city lights slide along it. See `.earth-spin`. */}
      <section className="earth-view relative h-[70vh] overflow-hidden bg-night-navy">
        {/* Pinned by the horizon (19.4% down the photo) to 12% down the section, so the curve of
            the Earth shows at any screen width. 26% wider than the section so its edges never
            show while it turns ±3° (the turn moves the top of the frame sideways by about 11% of
            the photo's width), and tall enough to reach the bottom. */}
        <div className="earth-spin absolute left-1/2 top-[8.4vh] aspect-[1920/1088] w-[max(126%,calc(80vh*1920/1088))] -translate-x-1/2 -translate-y-[19.4%]">
          <Image
            src={earth}
            alt="Earth at night, with lit cities linked by glowing lines and dark regions between them"
            fill
            sizes="(max-width: 768px) 200vw, 100vw"
            preload
            placeholder="blur"
            className="object-cover"
          />
        </div>
        {/* Side fades hide the slivers the turn would reveal, and melt the photo into the page. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-[10%] bg-linear-to-r from-night from-20% to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-[10%] bg-linear-to-l from-night from-20% to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-linear-to-b from-night-navy to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-linear-to-b from-transparent to-night"
        />
        <div className="absolute inset-x-0 bottom-0 flex justify-between px-6 py-6 font-mono text-[11px] uppercase tracking-wider text-white/60 md:px-10">
          <span>_02 Your network, mapped</span>
          <span>Port → Warehouse → Clinic</span>
        </div>
      </section>

      {/* Problem */}
      <section id="problem" className="px-6 py-28 md:px-10">
        <div className="font-mono text-[11px] uppercase tracking-wider text-white/60">
          _03 The problem
        </div>
        <p className="mt-10 max-w-6xl text-4xl leading-[1.05] tracking-[-0.04em] md:text-7xl">
          You run a rural clinic. Your vaccine fridge runs on a grid that keeps cutting out.{" "}
          <PowerOn className="text-aqua">Every kilowatt counts.</PowerOn>
        </p>
        <div className="mt-20 grid gap-10 border-t border-white/15 pt-10 md:grid-cols-3">
          {problems.map(([t, d]) => (
            <div key={t}>
              <h3 className="text-2xl tracking-tight">{t}</h3>
              <p className="mt-2 text-sm text-white/60">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Solution */}
      <section id="solution" className="border-t border-white/15 px-6 py-28 md:px-10">
        <div className="font-mono text-[11px] uppercase tracking-wider text-white/60">
          _04 The solution
        </div>
        <h2 className="mt-10 max-w-6xl text-4xl leading-[1.05] tracking-[-0.04em] md:text-7xl">
          Convoy decides where <span className="text-aqua">solar power does the most good</span>{" "}
          across your medical supply network.
        </h2>
        <p className="mt-8 max-w-xl text-lg text-white/75">
          Map your ports, warehouses, and clinics. Convoy weighs how supplies flow between them, how
          far they travel, how many people each clinic serves, and when each site is staffed and has
          power. Then it tells you which sites to equip first with the budget you have, how much
          shorter the wait for supplies becomes, and why.
        </p>
      </section>

      {/* How */}
      <section id="how" className="border-t border-white/15 px-6 py-28 md:px-10">
        <div className="flex justify-between font-mono text-[11px] uppercase tracking-wider text-white/60">
          <span>_05 Map your network</span>
          <span>6 inputs → 1 plan</span>
        </div>
        <div className="mt-12 divide-y divide-white/15 border-y border-white/15">
          {inputs.map(([n, t, d]) => (
            <div
              key={n}
              className="grid grid-cols-[3rem_1fr] items-baseline gap-4 py-6 md:grid-cols-[6rem_1fr_1fr]"
            >
              <span className="font-mono text-xs text-aqua">{n}</span>
              <span className="text-4xl tracking-[-0.04em] md:text-6xl">{t}</span>
              <span className="col-start-2 text-sm text-white/70 md:col-start-auto md:text-right">
                {d}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Results */}
      <section id="results" className="border-t border-white/15 px-6 py-28 md:px-10">
        <div className="flex justify-between font-mono text-[11px] uppercase tracking-wider text-white/60">
          <span>_06 What you get</span>
          <span>1 plan → 5 answers</span>
        </div>
        <div className="mt-12 divide-y divide-white/15 border-y border-white/15">
          {outputs.map(([t, d], i) => (
            <div
              key={t}
              className="grid grid-cols-[3rem_1fr] items-baseline gap-4 py-6 md:grid-cols-[6rem_1fr_1fr]"
            >
              <span className="font-mono text-xs text-aqua">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-4xl tracking-[-0.04em] md:text-6xl">{t}</span>
              <span className="col-start-2 text-sm text-white/70 md:col-start-auto md:text-right">
                {d}
              </span>
            </div>
          ))}
        </div>
        <Link
          href="/demo"
          className="mt-12 inline-flex items-center gap-3 rounded-sm bg-aqua px-5 py-3 text-sm font-medium text-night transition-colors hover:bg-white"
        >
          Try it on the Ghana sample network <span aria-hidden>↗</span>
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/15 px-6 py-16 md:px-10">
        <p className="text-[18vw] leading-[0.8] tracking-[-0.07em] text-aqua">
          <PowerOn>Power care.</PowerOn>
        </p>
        <div className="mt-10 flex justify-between font-mono text-[11px] uppercase tracking-wider text-white/50">
          <span>Convoy</span>
          <span>Emergent Hacks ©2026</span>
        </div>
      </footer>
    </main>
  );
}
