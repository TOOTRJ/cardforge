import { AnalyticsTable, EmptyNote, TablePanel } from "@/components/admin/analytics/charts";
import { periodLabel } from "@/lib/admin/analytics/params";
import { formatCount } from "@/lib/admin/analytics/series";
import type { CreditGrantRow, CreditGrantStats } from "@/lib/admin/credit-grant-stats";

// Credits granted by reason (owner 2026-11-06): the one-time plan credits,
// the free-period credits, packs, admin grants, referral credits and the
// old monthly refills — in the period and all time. A refund is not a
// grant and is not here (lib/admin/credit-grant-stats.ts). Server component.
export function CreditGrantsPanel({ stats, days = 30 }: { stats: CreditGrantStats; days?: number }) {
  const by = (rows: CreditGrantRow[], reason: string) => rows.find((r) => r.reason === reason);
  const reasons = [...new Set([...stats.period, ...stats.allTime].map((r) => r.reason))].sort(
    (a, b) =>
      (by(stats.period, b)?.credits ?? 0) - (by(stats.period, a)?.credits ?? 0) ||
      (by(stats.allTime, b)?.credits ?? 0) - (by(stats.allTime, a)?.credits ?? 0) ||
      a.localeCompare(b),
  );
  const label = (reason: string) => (by(stats.allTime, reason) ?? by(stats.period, reason))?.label ?? reason;
  const total = (rows: CreditGrantRow[], pick: (row: CreditGrantRow) => number) => rows.reduce((n, row) => n + pick(row), 0);
  const strong = (text: string) => <span className="font-semibold text-foreground">{text}</span>;
  return (
    <TablePanel
      title="Credits granted"
      description={`What handed out credits, in ${periodLabel(days)} and all time. A refund gives a charge back; it is not a grant and is not in this table.`}
    >
      {reasons.length === 0 ? (
        <EmptyNote>No credits granted yet.</EmptyNote>
      ) : (
        <AnalyticsTable
          caption="Credits granted by reason"
          columns={["Reason", "This period", "Grants", "All time", "Grants, all time"]}
          rows={[
            ...reasons.map((reason) => {
              const period = by(stats.period, reason);
              const all = by(stats.allTime, reason);
              return {
                key: reason,
                cells: [
                  label(reason),
                  period ? formatCount(period.credits) : "—",
                  period ? formatCount(period.grants) : "—",
                  all ? formatCount(all.credits) : "—",
                  all ? formatCount(all.grants) : "—",
                ],
              };
            }),
            {
              key: "total",
              cells: [
                strong("Total"),
                strong(formatCount(total(stats.period, (r) => r.credits))),
                strong(formatCount(total(stats.period, (r) => r.grants))),
                strong(formatCount(total(stats.allTime, (r) => r.credits))),
                strong(formatCount(total(stats.allTime, (r) => r.grants))),
              ],
            },
          ]}
        />
      )}
    </TablePanel>
  );
}
