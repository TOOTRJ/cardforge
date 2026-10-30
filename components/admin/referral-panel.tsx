import Link from "next/link";
import { Gift } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { activationRate, type ReferralStatsSummary } from "@/lib/admin/referral-queries";

const BLOCK_LABEL: Record<string, string> = {
  same_email: "Same inbox",
  same_card: "Same card",
  same_domain: "Same company domain (friend rewarded)",
  disposable_email: "Throwaway email",
  not_new: "Not a new account",
};

// Referral program numbers (0153's admin_referral_stats): the chain
// signups → first card → rewarded, months granted on both sides, what was
// held back and why, and the top referrers. Server component; the page
// already runs as an admin.
export function ReferralPanel({ summary }: { summary: ReferralStatsSummary }) {
  const { last30, allTime } = summary;
  const rows: Array<{ label: string; d30: number; all: number }> = [
    { label: "Signed up through a link", d30: last30.signedUp, all: allTime.signedUp },
    { label: "Saved a first card", d30: last30.firstCard, all: allTime.firstCard },
    { label: "Rewarded (both sides)", d30: last30.rewarded, all: allTime.rewarded },
    { label: "Capped (friend only)", d30: last30.capped, all: allTime.capped },
    { label: "Blocked", d30: last30.blocked, all: allTime.blocked },
    { label: "Expired (no card in 30 days)", d30: last30.expired, all: allTime.expired },
    { label: "Free months granted", d30: last30.monthsGranted, all: allTime.monthsGranted },
  ];
  const rate30 = activationRate(last30);
  const reasons = Object.entries(allTime.blockReasons).filter(([, n]) => n > 0);
  return (
    <SurfaceCard className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gift className="h-4 w-4 text-gold-strong" aria-hidden />
          <h2 className="font-display text-base font-semibold text-foreground">Referrals</h2>
        </div>
        <span className="text-xs text-muted">
          Signup windows: last 30 days and all time · activation 30d: {rate30 == null ? "—" : `${rate30}%`}
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-background/40 p-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-subtle">
                <th scope="col" className="pb-1 text-left font-medium">Step</th>
                <th scope="col" className="whitespace-nowrap pb-1 pl-3 text-right font-medium">30d</th>
                <th scope="col" className="whitespace-nowrap pb-1 pl-3 text-right font-medium">All time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-t border-border/40">
                  <td className="py-1 pr-2 text-foreground">{row.label}</td>
                  <td className="whitespace-nowrap py-1 pl-3 text-right tabular-nums text-foreground">{row.d30}</td>
                  <td className="whitespace-nowrap py-1 pl-3 text-right tabular-nums text-muted">{row.all}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {reasons.length > 0 ? (
            <p className="mt-2 text-xs text-muted">
              Blocked, all time: {reasons.map(([k, n]) => `${BLOCK_LABEL[k] ?? k} ${n}`).join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="rounded-lg border border-border/60 bg-background/40 p-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Top referrers · all time</h3>
          {allTime.topReferrers.length === 0 ? (
            <p className="text-sm text-muted">No referrals yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-subtle">
                  <th scope="col" className="pb-1 text-left font-medium">User</th>
                  <th scope="col" className="pb-1 pl-3 text-right font-medium">Joined</th>
                  <th scope="col" className="pb-1 pl-3 text-right font-medium">First card</th>
                  <th scope="col" className="pb-1 pl-3 text-right font-medium">Months</th>
                </tr>
              </thead>
              <tbody>
                {allTime.topReferrers.map((r) => (
                  <tr key={r.userId} className="border-t border-border/40">
                    <td className="py-1 pr-2">
                      <Link href={`/admin/users?u=${r.userId}`} className="text-foreground hover:underline">
                        {r.username ? `@${r.username}` : r.userId.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="py-1 pl-3 text-right tabular-nums text-muted">{r.referrals}</td>
                    <td className="py-1 pl-3 text-right tabular-nums text-muted">{r.activated}</td>
                    <td className="py-1 pl-3 text-right tabular-nums text-foreground">{r.months}</td>
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
