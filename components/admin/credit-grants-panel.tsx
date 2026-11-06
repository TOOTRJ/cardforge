import { Coins } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import type { CreditGrantStats } from "@/lib/admin/credit-grant-stats";

// Credits granted by reason (owner 2026-11-06): the one-time plan credits,
// the free-period credits, packs, admin grants, referral credits and the
// old monthly refills, over 30 days and all time. Server component.
export function CreditGrantsPanel({ stats }: { stats: CreditGrantStats }) {
  const reasons = [...new Set([...stats.last30, ...stats.allTime].map((r) => r.reason))];
  const by = (rows: CreditGrantStats["last30"], reason: string) => rows.find((r) => r.reason === reason);
  const label = (reason: string) => (by(stats.allTime, reason) ?? by(stats.last30, reason))?.label ?? reason;
  const td = "whitespace-nowrap py-1 pl-3 text-right tabular-nums";
  return (
    <SurfaceCard className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-gold-strong" aria-hidden />
          <h2 className="font-display text-base font-semibold text-foreground">Credits granted</h2>
        </div>
        <span className="text-xs text-muted">By reason · credits (grants) · last 30 days and all time</span>
      </div>
      {reasons.length === 0 ? (
        <p className="text-sm text-muted">No credits granted yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-subtle">
              <th scope="col" className="pb-1 text-left font-medium">Reason</th>
              <th scope="col" className="whitespace-nowrap pb-1 pl-3 text-right font-medium">30d</th>
              <th scope="col" className="whitespace-nowrap pb-1 pl-3 text-right font-medium">All time</th>
            </tr>
          </thead>
          <tbody>
            {reasons.map((reason) => {
              const d30 = by(stats.last30, reason);
              const all = by(stats.allTime, reason);
              return (
                <tr key={reason} className="border-t border-border/40">
                  <td className="py-1 pr-2 text-foreground">{label(reason)}</td>
                  <td className={`${td} text-foreground`}>{d30 ? `${d30.credits} (${d30.grants})` : "—"}</td>
                  <td className={`${td} text-muted`}>{all ? `${all.credits} (${all.grants})` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </SurfaceCard>
  );
}
