import { Filter } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import type { FunnelSummary } from "@/lib/admin/funnel-queries";

// Funnel counts for the trailing 7 and 30 days, from funnel_events. Counts
// sit beside every rate on purpose: at this volume a rate without its
// numerator is noise. Server component; the page already runs as an admin.
export function FunnelPanel({ summary }: { summary: FunnelSummary }) {
  const [d7, d30] = summary.windows;
  return (
    <SurfaceCard className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gold-strong" aria-hidden />
          <h2 className="font-display text-base font-semibold text-foreground">Funnel</h2>
        </div>
        <span className="text-xs text-muted">
          Counts, distinct users in parentheses, and step-to-step rates · last 7 and 30 days
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {d30.sections.map((section, i) => (
          <div key={section.title} className="rounded-lg border border-border/60 bg-background/40 p-3">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">{section.title}</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-subtle">
                  <th className="pb-1 text-left font-medium">Step</th>
                  <th className="pb-1 text-right font-medium">7d</th>
                  <th className="pb-1 text-right font-medium">30d</th>
                  <th className="pb-1 text-right font-medium">Rate 30d</th>
                </tr>
              </thead>
              <tbody>
                {section.steps.map((step, j) => {
                  const s7 = d7.sections[i]?.steps[j];
                  return (
                    <tr key={step.key} className="border-t border-border/40">
                      <td className="py-1 pr-2 text-foreground">{step.label}</td>
                      <td className="py-1 text-right tabular-nums text-muted">
                        {s7?.n ?? 0}
                        {s7 && s7.users > 0 ? <span className="text-subtle"> ({s7.users})</span> : null}
                      </td>
                      <td className="py-1 text-right tabular-nums text-foreground">
                        {step.n}
                        {step.users > 0 ? <span className="text-subtle"> ({step.users})</span> : null}
                      </td>
                      <td className="py-1 text-right tabular-nums text-muted">
                        {step.rate == null ? "—" : `${step.rate}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
}
