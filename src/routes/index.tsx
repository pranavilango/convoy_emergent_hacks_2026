import { createFileRoute } from "@tanstack/react-router";
import earth from "@/assets/earth-network.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Convoy — Growth planner for small businesses" },
      {
        name: "description",
        content:
          "A preconfigured linear-time logistics analysis platform for SMEs to optimize scaling.",
      },
      { property: "og:title", content: "Convoy — Growth planner for small businesses" },
      {
        property: "og:description",
        content: "Upload your network. Convoy tells you the highest-impact changes to make next.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const outputs = ["New store", "Delivery zone", "Working hours", "Fleet size", "Order routing"];

const inputs = [
  ["01", "Locations", "Stores, kitchens, depots."],
  ["02", "Working hours", "When each site and driver is on."],
  ["03", "Order sizes", "What customers buy, and where."],
  ["04", "Vehicles", "Bikes, vans, capacity, cost."],
];

function Arrow() {
  return <span className="font-mono text-xs">↘</span>;
}

function Index() {
  return (
    <main className="bg-background font-display text-foreground">
      {/* Nav */}
      <header className="flex items-center justify-between border-b border-foreground/30 px-6 py-4 md:px-10">
        <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="inline-block h-4 w-4 rounded-sm bg-foreground" />
          Convoy
        </div>
        <nav className="hidden gap-8 text-sm md:flex">
          <a href="#problem">Problem</a>
          <a href="#solution">Solution</a>
          <a href="#how">How it works</a>
        </nav>
        <a
          href="#how"
          className="rounded-sm bg-foreground px-4 py-2 text-sm text-background transition-opacity hover:opacity-85"
        >
          Try the demo
        </a>
      </header>

      {/* Hero */}
      <section className="px-6 pb-12 pt-4 md:px-10">
        <div className="flex justify-between font-mono text-[11px] uppercase tracking-wider">
          <span>_01</span>
          <span>Hackathon ©2026</span>
          <span>Built for SMEs</span>
        </div>

        <div className="mt-16 grid grid-cols-1 items-end gap-8 md:grid-cols-[1fr_auto]">
          <h1 className="text-[26vw] font-medium leading-[0.8] tracking-[-0.07em] md:text-[19vw]">
            Convoy
          </h1>
          <ul className="space-y-1 pb-6 text-lg">
            {outputs.map((o) => (
              <li key={o} className="flex w-56 items-center justify-between">
                {o} <Arrow />
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 grid grid-cols-1 items-end gap-8 md:grid-cols-[18rem_1fr]">
          <div className="text-sm">
            <p className="max-w-xs">
              A preconfigured linear-time logistics analysis platform for SMEs to optimize
              scaling.
            </p>
            <a
              href="#solution"
              className="mt-4 flex items-center justify-between border-b border-foreground pb-1"
            >
              Explore more <span>↗</span>
            </a>
          </div>
          <p className="text-5xl font-normal leading-[0.9] tracking-[-0.05em] md:text-right md:text-[7.5vw]">
            Growth Planner
          </p>
        </div>
      </section>

      {/* Image */}
      <section className="relative bg-ink text-ink-foreground">
        <img src={earth} alt="City lights connected by glowing delivery routes" width={1920} height={1088} className="h-[70vh] w-full object-cover" />
        <div className="absolute inset-x-0 bottom-0 flex justify-between px-6 py-6 font-mono text-[11px] uppercase tracking-wider md:px-10">
          <span>_02 Your network, mapped</span>
          <span>Linear-time analysis</span>
        </div>
      </section>

      {/* Problem */}
      <section id="problem" className="bg-ink px-6 py-28 text-ink-foreground md:px-10">
        <div className="font-mono text-[11px] uppercase tracking-wider opacity-70">_03 The problem</div>
        <p className="mt-10 max-w-6xl text-4xl leading-[1.05] tracking-[-0.04em] md:text-7xl">
          You're a local bakery. You want to deliver cupcakes to more people.{" "}
          <span className="text-background">Every resource counts.</span>
        </p>
        <div className="mt-20 grid gap-10 border-t border-ink-foreground/20 pt-10 md:grid-cols-3">
          {[
            ["Technical", "Existing tools assume you have an operations research team."],
            ["Expensive", "Enterprise pricing built for enterprise fleets."],
            ["Not actionable", "Dashboards full of numbers — no clear next step."],
          ].map(([t, d]) => (
            <div key={t}>
              <h3 className="text-2xl tracking-tight">{t}</h3>
              <p className="mt-2 text-sm opacity-70">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Solution */}
      <section id="solution" className="px-6 py-28 md:px-10">
        <div className="font-mono text-[11px] uppercase tracking-wider">_04 The solution</div>
        <h2 className="mt-10 max-w-6xl text-4xl leading-[1.05] tracking-[-0.04em] md:text-7xl">
          Convoy is a growth planner built specifically for small businesses.
        </h2>
        <p className="mt-8 max-w-xl text-lg">
          It tells you which practical changes will yield the highest impact — where to open a new
          store, which neighbourhood to expand delivery to, and your optimal working hours.
        </p>
      </section>

      {/* How */}
      <section id="how" className="border-t border-foreground/30 px-6 py-28 md:px-10">
        <div className="flex justify-between font-mono text-[11px] uppercase tracking-wider">
          <span>_05 Upload your network</span>
          <span>4 inputs → 1 plan</span>
        </div>
        <div className="mt-12 divide-y divide-foreground/30 border-y border-foreground/30">
          {inputs.map(([n, t, d]) => (
            <div key={n} className="grid grid-cols-[3rem_1fr] items-baseline gap-4 py-6 md:grid-cols-[6rem_1fr_1fr]">
              <span className="font-mono text-xs">{n}</span>
              <span className="text-4xl tracking-[-0.04em] md:text-6xl">{t}</span>
              <span className="col-start-2 text-sm md:col-start-auto md:text-right">{d}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-ink px-6 py-16 text-ink-foreground md:px-10">
        <p className="text-[18vw] leading-[0.8] tracking-[-0.07em]">Scale smart.</p>
        <div className="mt-10 flex justify-between font-mono text-[11px] uppercase tracking-wider opacity-70">
          <span>Convoy</span>
          <span>Hackathon project ©2026</span>
        </div>
      </footer>
    </main>
  );
}
