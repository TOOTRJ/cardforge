import { formatUtcDate } from "@/lib/format/dates";
import type { ToolDailyPoint } from "@/lib/tools/admin-queries";

// ---------------------------------------------------------------------------
// One tool's uses per UTC day — a single-series bar chart (no legend: the
// title names it), bars in --color-chart-1 with 4 px rounded tops on a
// recessive baseline, 2 px gaps, a hover / focus tooltip per day (the hit
// area is the whole column, not the bar) and its TABLE twin below for a
// screen reader or anyone who'd rather read the numbers. Plain HTML + CSS,
// so it renders on the server with no chart library.
// ---------------------------------------------------------------------------

export function UsageChart({ daily, caption }: { daily: ToolDailyPoint[]; caption: string }) {
  const max = Math.max(1, ...daily.map((d) => d.uses));
  const total = daily.reduce((sum, d) => sum + d.uses, 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="sr-only">{caption}</figcaption>
      <div className="relative flex h-48 gap-3" aria-hidden>
        {/* Y axis: three recessive ticks. */}
        <div className="flex w-8 shrink-0 flex-col-reverse justify-between text-right font-mono text-[10px] tabular-nums text-subtle">
          {ticks.map((t) => (
            <span key={t} className="-mb-1.5 leading-3">
              {t}
            </span>
          ))}
        </div>
        <div className="relative flex min-w-0 flex-1 items-end gap-[2px] border-b border-border">
          {ticks.slice(1).map((t) => (
            <span
              key={t}
              className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border/40"
              style={{ bottom: `${(t / top) * 100}%` }}
            />
          ))}
          {daily.map((d) => (
            <div key={d.day} className="group relative flex h-full min-w-0 flex-1 items-end">
              <div
                className="w-full rounded-t-[4px] bg-chart-1 transition-opacity group-hover:opacity-80"
                style={{ height: d.uses === 0 ? 0 : `max(2px, ${(d.uses / top) * 100}%)` }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs shadow-lg group-hover:block">
                <p className="font-medium text-foreground">{formatUtcDate(d.day, "short")}</p>
                <p className="text-muted">
                  {d.uses} use{d.uses === 1 ? "" : "s"} · {d.opens} open{d.opens === 1 ? "" : "s"} · {d.users} user
                  {d.users === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
      {daily.length > 0 ? (
        <div className="flex justify-between pl-11 font-mono text-[10px] text-subtle" aria-hidden>
          <span>{formatUtcDate(daily[0].day, "short")}</span>
          <span>{formatUtcDate(daily[daily.length - 1].day, "short")}</span>
        </div>
      ) : null}
      {total === 0 ? (
        <p className="text-sm text-muted">No uses in this period yet.</p>
      ) : null}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60">
          Show as a table
        </summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-md border border-border/60">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{caption}</caption>
            <thead className="sticky top-0 bg-elevated text-subtle">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">Day (UTC)</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Uses</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Opens</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Users</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((d) => (
                <tr key={d.day} className="border-t border-border/40">
                  <th scope="row" className="px-3 py-1 font-normal text-foreground">{formatUtcDate(d.day, "short")}</th>
                  <td className="px-3 py-1 text-right tabular-nums">{d.uses}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{d.opens}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{d.users}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** 0, a middle and a top tick on whole, readable numbers. */
export function niceTicks(max: number): number[] {
  const steps = [1, 2, 5];
  let magnitude = 1;
  while (true) {
    for (const s of steps) {
      const step = s * magnitude;
      if (step * 2 >= max) return [0, step, step * 2];
    }
    magnitude *= 10;
  }
}
