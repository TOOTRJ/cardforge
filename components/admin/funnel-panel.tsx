import Link from "next/link";
import { Filter } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { formatCalendarDate } from "@/lib/format/dates";
import type { FunnelSummary } from "@/lib/admin/funnel-queries";

const OUTCOME_LABEL: Record<string, string> = {
  trial_converted: "Converted",
  trial_lapsed: "Lapsed",
  ongoing: "Ongoing",
  unknown: "—",
};

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

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-background/40 p-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Signups by source · 30d</h3>
          {summary.signupSources.length === 0 ? (
            <p className="text-sm text-muted">No signups recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border/40 text-sm">
              {summary.signupSources.map((row) => (
                <li key={row.source} className="flex items-center justify-between py-1">
                  <span className="text-foreground">{row.source}</span>
                  <span className="tabular-nums text-muted">{row.n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-border/60 bg-background/40 p-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">
            Trial engagement · trials started in the last 30d
          </h3>
          {summary.trials.length === 0 ? (
            <p className="text-sm text-muted">No trials in the window.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-subtle">
                  <th className="pb-1 text-left font-medium">User</th>
                  <th className="pb-1 text-left font-medium">Started</th>
                  <th className="pb-1 text-left font-medium">Outcome</th>
                  <th className="pb-1 text-right font-medium">Days</th>
                  <th className="pb-1 text-right font-medium">Saves</th>
                  <th className="pb-1 text-right font-medium">Gens</th>
                  <th className="pb-1 text-right font-medium">DLs</th>
                </tr>
              </thead>
              <tbody>
                {summary.trials.map((t) => (
                  <tr key={`${t.userId}-${t.startedAt}`} className="border-t border-border/40">
                    <td className="py-1 pr-2">
                      <Link href={`/admin/users?u=${t.userId}`} className="font-medium text-primary-bright hover:underline">
                        {t.username ? `@${t.username}` : t.userId.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="py-1 pr-2 text-muted">{formatCalendarDate(t.startedAt)}</td>
                    <td className="py-1 pr-2 text-foreground">{OUTCOME_LABEL[t.outcome] ?? t.outcome}</td>
                    <td className="py-1 text-right tabular-nums">{t.activeDays}</td>
                    <td className="py-1 text-right tabular-nums">{t.saves}</td>
                    <td className="py-1 text-right tabular-nums">{t.generations}</td>
                    <td className="py-1 text-right tabular-nums">{t.downloads}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </SurfaceCard>
  );
}
