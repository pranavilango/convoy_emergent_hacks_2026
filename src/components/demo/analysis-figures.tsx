import { peopleLabel } from "@/lib/demo/population";
import { formatHours, type AnalysisSummary } from "@/lib/solar-allocation/summary";

/**
 * The analysis in plain terms: how much sooner medicines reach clinics, where the time goes
 * (driving vs waiting for a site to be staffed and powered), each clinic's own time, and how the
 * plan compares with the obvious choice. Every number comes from the engine via
 * `summarizeAnalysis`.
 */

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** The headline: how much sooner, and before → after. */
export function ImpactHeadline({
  summary,
  coversEverySite,
}: {
  summary: AnalysisSummary;
  /** Set when the budget covers more units than there are sites: how many sites there are. */
  coversEverySite: number | null;
}) {
  const faster = summary.saved >= 0.05;
  return (
    <div className="space-y-2">
      <p className="text-2xl leading-tight tracking-[-0.02em] md:text-3xl">
        {faster ? (
          <>
            Medicines reach clinics{" "}
            <span className="text-brand">{formatHours(summary.saved)} sooner</span> on average
          </>
        ) : (
          <>Solar doesn&apos;t shorten deliveries in this network</>
        )}
      </p>
      <p className="font-mono text-[11px] uppercase tracking-wider text-white/70">
        {faster ? (
          <>
            {formatHours(summary.before)} → {formatHours(summary.after)} from port to clinic ·{" "}
            {percent(summary.share)} faster
          </>
        ) : (
          <>Average port to clinic: {formatHours(summary.before)}</>
        )}
        {coversEverySite !== null && <> · the budget covers all {coversEverySite} sites</>}
      </p>
    </div>
  );
}

/**
 * Two thin bars on one scale: without solar and with the plan, each split into driving (grey)
 * and waiting for staff and power (blue). Solar only ever shrinks the blue part.
 */
export function TimeSplit({
  split,
  before,
  after,
}: {
  split: NonNullable<AnalysisSummary["split"]>;
  before: number;
  after: number;
}) {
  const scale = Math.max(before, after, 1e-9);
  const rows = [
    { label: "Without solar", waiting: split.waitingBefore, total: before },
    { label: "With this plan", waiting: split.waitingAfter, total: after },
  ];
  const cut = split.waitingBefore > 0 ? 1 - split.waitingAfter / split.waitingBefore : 0;
  return (
    <div className="space-y-3">
      <div aria-hidden className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/70">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-3 rounded-full bg-white/40" /> Driving
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-3 rounded-full bg-brand" /> Waiting for a site to be
          staffed and powered
        </span>
      </div>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.label} className="grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-1">
            <span className="text-xs text-white/70">{row.label}</span>
            <div
              role="img"
              aria-label={`${row.label}: ${formatHours(split.driving)} driving and ${formatHours(row.waiting)} waiting, ${formatHours(row.total)} in all`}
              className="flex h-2 gap-[2px]"
              style={{ width: `${(row.total / scale) * 100}%` }}
            >
              <span
                className="h-full rounded-l-full bg-white/40"
                style={{ flexGrow: split.driving, flexBasis: 0 }}
              />
              {row.waiting > 0 && (
                <span
                  className="h-full rounded-r-full bg-brand"
                  style={{ flexGrow: row.waiting, flexBasis: 0 }}
                />
              )}
            </div>
            <span aria-hidden className="col-start-2 font-mono text-[11px] text-white/70">
              <span className="text-white">{formatHours(row.total)}</span> ={" "}
              {formatHours(split.driving)} driving + {formatHours(row.waiting)} waiting
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-white/70">
        Solar can&apos;t shorten the drive. It cuts the waiting
        {cut >= 0.005 && (
          <>
            {" "}
            by <span className="text-white">{percent(cut)}</span>
          </>
        )}
        , because sites can take in medicines whenever they&apos;re staffed, not only when the grid
        is on.
      </p>
    </div>
  );
}

/** Each clinic's own port-to-clinic time, before and after; the ones that get faster first. */
export function ClinicTimesTable({ summary }: { summary: AnalysisSummary }) {
  const clinics = summary.clinics ?? [];
  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <caption className="sr-only">Average port-to-clinic time for each clinic</caption>
        <thead>
          <tr className="font-mono text-[10px] uppercase tracking-wider text-white/50">
            <th scope="col" className="pb-2 text-left font-normal">
              Clinic
            </th>
            <th scope="col" className="pb-2 text-right font-normal">
              Without solar
            </th>
            <th scope="col" className="pb-2 pl-4 text-right font-normal">
              With this plan
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/15 border-y border-white/15">
          {clinics.map((clinic) => (
            <tr key={clinic.id}>
              <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                <span className="block leading-tight">{clinic.name}</span>
                {clinic.people !== null && (
                  <span className="block text-xs text-white/50">{peopleLabel(clinic.people)}</span>
                )}
              </th>
              <td className="py-2.5 text-right font-mono text-xs whitespace-nowrap text-white/70">
                {formatHours(clinic.before)}
              </td>
              <td className="py-2.5 pl-4 text-right font-mono text-xs whitespace-nowrap">
                {clinic.faster ? (
                  <>
                    <span className="text-brand">{formatHours(clinic.after)}</span>
                    <span className="block text-[10px] text-white/50">
                      {formatHours(Math.round((clinic.before - clinic.after) * 10) / 10)} sooner
                    </span>
                  </>
                ) : (
                  <span className="text-white/50">no change</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {summary.peopleSooner !== null && summary.peopleTotal > 0 && (
        <p className="text-sm text-white/70">
          <span className="text-white">{peopleLabel(summary.peopleSooner)}</span> of{" "}
          {summary.peopleTotal.toLocaleString("en-US")} are at clinics that get medicines sooner.
        </p>
      )}
    </div>
  );
}

/** Convoy's plan against the obvious one: solar on the clinics serving the most people. */
export function ObviousComparison({
  obvious,
  after,
}: {
  obvious: NonNullable<AnalysisSummary["obvious"]>;
  after: number;
}) {
  const count = obvious.sites.length;
  const obviousLabel = `Solar on the ${count === 1 ? "clinic" : `${count} clinics`} serving the most people`;
  if (obvious.sameAsPlan || Math.abs(obvious.convoyFasterBy) < 0.05) {
    return (
      <p className="text-sm text-white/70">
        {obviousLabel} ({obvious.sites.join(", ")}) would also take{" "}
        <span className="text-white">{formatHours(after)}</span>
        {obvious.sameAsPlan ? ": here, the biggest clinics are the best choice." : "."}
      </p>
    );
  }
  const rows = [
    { label: obviousLabel, detail: obvious.sites.join(", "), hours: obvious.hours, ours: false },
    { label: "Convoy's plan", detail: null, hours: after, ours: true },
  ];
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-white/15 border-y border-white/15">
        {rows.map((row) => (
          <li key={row.label} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
            <span className="min-w-0">
              <span className={row.ours ? "text-white" : "text-white/70"}>{row.label}</span>
              {row.detail && <span className="block text-xs text-white/50">{row.detail}</span>}
            </span>
            <span
              className={`shrink-0 font-mono text-xs ${row.ours ? "text-brand" : "text-white/70"}`}
            >
              {formatHours(row.hours)}
            </span>
          </li>
        ))}
      </ul>
      {obvious.convoyFasterBy > 0 && (
        <p className="text-sm text-white/70">
          Convoy&apos;s plan gets medicines to clinics{" "}
          <span className="text-white">{formatHours(obvious.convoyFasterBy)} sooner</span> on
          average than the obvious choice.
          {obvious.warehouses.map((w) => (
            <span key={w.name}>
              {" "}
              Solar at {w.name} speeds up{" "}
              {w.clinics.length === 1
                ? "the clinic"
                : w.clinics.length === 2
                  ? "both clinics"
                  : `all ${w.clinics.length} clinics`}{" "}
              it supplies ({w.clinics.join(", ")}).
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
