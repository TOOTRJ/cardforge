import Link from "next/link";
import { Gift } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import {
  REFERRAL_BLOCK_LABELS,
  activationRate,
  qualificationRate,
  type ReferralStatsSummary,
  type ReferralStatsWindow,
} from "@/lib/admin/referral-queries";
import { ReferralSettingsForm } from "@/components/admin/referral-settings-form";
import type { ReferralSettings } from "@/lib/referrals/settings";

const SOURCE_LABEL: Record<string, string> = {
  signup: "Signup days",
  referral_friend: "Referral — friend",
  referral_step: "Referral — ladder",
  admin: "Admin comps",
  promo: "Promotions",
};

const td = "whitespace-nowrap py-1 pl-3 text-right tabular-nums";

// Referral program numbers, v2 (0180's admin_referral_stats; owner
// 2026-11-06: detailed stats on the referrals and the days banked): the
// chain signups → cards saved → a plan started → rewarded, what was held
// back and why, the top referrers with their ladder step, the last 30 days
// day by day, the ladder's distribution and credits, the days bank's
// ledger — and the program's SETTINGS form. Server component; the page
// already runs as an admin.
export function ReferralPanel({ summary, settings }: { summary: ReferralStatsSummary; settings?: ReferralSettings }) {
  const { last30, allTime } = summary;
  const rows: Array<{ label: string; d30: number; all: number }> = [
    { label: "Signed up through a link", d30: last30.signedUp, all: allTime.signedUp },
    { label: "Saved the cards", d30: last30.cardsSaved, all: allTime.cardsSaved },
    { label: "Rewarded (both sides)", d30: last30.rewarded, all: allTime.rewarded },
    { label: "Started a plan (not needed for the reward)", d30: last30.cardOnFile, all: allTime.cardOnFile },
    { label: "Capped (friends a month)", d30: last30.capped, all: allTime.capped },
    { label: "Blocked", d30: last30.blocked, all: allTime.blocked },
    { label: "Expired (no cards in the window)", d30: last30.expired, all: allTime.expired },
    { label: "Waiting (cards saved, reward not given yet)", d30: last30.waiting, all: allTime.waiting },
    { label: "Rewards granted (both sides)", d30: last30.rewardsGranted, all: allTime.rewardsGranted },
    { label: "AI credits through the ladder", d30: last30.ladderCredits, all: allTime.ladderCredits },
  ];
  const rate30 = activationRate(last30);
  const qual30 = qualificationRate(last30);
  const reasons = Object.entries(allTime.blockReasons).filter(([, n]) => n > 0);
  const steps = Object.entries(allTime.ladderSteps).sort((a, b) => stepOrder(a[0]) - stepOrder(b[0]));
  const perDay = last30.perDay.slice(-30);
  const busy = perDay.filter((d) => d.signedUp + d.cardsSaved + d.cardOnFile + d.rewarded > 0);
  return (
    <SurfaceCard className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gift className="h-4 w-4 text-gold-strong" aria-hidden />
          <h2 className="font-display text-base font-semibold text-foreground">Referrals and the days bank</h2>
        </div>
        <span className="text-xs text-muted">
          Signup windows: last 30 days and all time · 30d cards saved {rate30 == null ? "—" : `${rate30}%`} · went on to a
          plan {qual30 == null ? "—" : `${qual30}%`}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-border/60 bg-background/40 p-3">
          <div className="relative overflow-x-auto">
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
                  <td className={`${td} text-foreground`}>{row.d30}</td>
                  <td className={`${td} text-muted`}>{row.all}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {allTime.grantsOwed > 0 ? (
            <p className="mt-2 text-xs text-gold-strong">
              {allTime.grantsOwed} reward{allTime.grantsOwed === 1 ? " is" : "s are"} still owed — the hourly sweep
              retries them.
            </p>
          ) : null}
          {reasons.length > 0 ? (
            <p className="mt-2 text-xs text-muted">
              Blocked, all time: {reasons.map(([k, n]) => `${REFERRAL_BLOCK_LABELS[k] ?? k} ${n}`).join(" · ")}
            </p>
          ) : null}
          {steps.length > 0 ? (
            <p className="mt-2 text-xs text-muted">
              Referrers by rewarded referrals: {steps.map(([k, n]) => `${k} → ${n}`).join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="min-w-0 rounded-lg border border-border/60 bg-background/40 p-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Top referrers · all time</h3>
          {allTime.topReferrers.length === 0 ? (
            <p className="text-sm text-muted">No referrals yet.</p>
          ) : (
            <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-subtle">
                  <th scope="col" className="pb-1 text-left font-medium">User</th>
                  <th scope="col" className="pb-1 pl-3 text-right font-medium">Joined</th>
                  <th scope="col" className="pb-1 pl-3 text-right font-medium">Cards</th>
                  <th scope="col" className="pb-1 pl-3 text-right font-medium">Plan</th>
                  <th scope="col" className="pb-1 pl-3 text-right font-medium">Rewards</th>
                  <th scope="col" className="pb-1 pl-3 text-right font-medium">Step</th>
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
                    <td className={`${td} text-muted`}>{r.referrals}</td>
                    <td className={`${td} text-muted`}>{r.activated}</td>
                    <td className={`${td} text-muted`}>{r.cardOnFile}</td>
                    <td className={`${td} text-foreground`}>{r.rewards}</td>
                    <td className={`${td} text-muted`}>{r.step ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-border/60 bg-background/40 p-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Last 30 days, day by day</h3>
          {busy.length === 0 ? (
            <p className="text-sm text-muted">Nothing moved in the last 30 days.</p>
          ) : (
            <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-subtle">
                  <th scope="col" className="pb-1 text-left font-medium">Day (UTC)</th>
                  <th scope="col" className="pb-1 pl-3 text-right font-medium">Signed up</th>
                  <th scope="col" className="pb-1 pl-3 text-right font-medium">Cards</th>
                  <th scope="col" className="pb-1 pl-3 text-right font-medium">Plan</th>
                  <th scope="col" className="pb-1 pl-3 text-right font-medium">Rewarded</th>
                </tr>
              </thead>
              <tbody>
                {busy.map((d) => (
                  <tr key={d.day} className="border-t border-border/40">
                    <td className="py-1 pr-2 tabular-nums text-foreground">{d.day}</td>
                    <td className={`${td} text-muted`}>{d.signedUp}</td>
                    <td className={`${td} text-muted`}>{d.cardsSaved}</td>
                    <td className={`${td} text-muted`}>{d.cardOnFile}</td>
                    <td className={`${td} text-foreground`}>{d.rewarded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          <p className="mt-2 text-xs text-subtle">Days with nothing to show are left out.</p>
        </div>
        <BankStats last30={last30} allTime={allTime} />
      </div>

      {settings ? <ReferralSettingsForm initial={settings} /> : null}
    </SurfaceCard>
  );
}

function stepOrder(bucket: string): number {
  return bucket.endsWith("+") ? Number(bucket.slice(0, -1)) + 0.5 : Number(bucket);
}

function BankStats({ last30, allTime }: { last30: ReferralStatsWindow; allTime: ReferralStatsWindow }) {
  const b30 = last30.bank;
  const all = allTime.bank;
  const rows: Array<{ label: string; d30: number | string; all: number | string }> = [
    { label: "Days banked (waiting)", d30: b30.bankedDays, all: all.bankedDays },
    { label: "Days reserved (a checkout in flight)", d30: b30.reservedDays, all: all.reservedDays },
    { label: "Days applied", d30: b30.appliedDays, all: all.appliedDays },
    { label: "— at a checkout (free period)", d30: `${b30.appliedCheckoutDays} / ${b30.appliedCheckouts}`, all: `${all.appliedCheckoutDays} / ${all.appliedCheckouts}` },
    { label: "— to a live plan (Apply)", d30: `${b30.appliedHoldDays} / ${b30.appliedHolds}`, all: `${all.appliedHoldDays} / ${all.appliedHolds}` },
    { label: "Days revoked", d30: b30.revokedDays, all: all.revokedDays },
    { label: "Users with days waiting", d30: b30.usersWithBank, all: all.usersWithBank },
    { label: "Signup entries made", d30: b30.signupEntries, all: all.signupEntries },
    { label: "— applied / revoked (not owed) / waiting", d30: `${b30.signupApplied} / ${b30.signupRevoked} / ${b30.signupBanked}`, all: `${all.signupApplied} / ${all.signupRevoked} / ${all.signupBanked}` },
  ];
  const sources = Object.entries(all.bySource).sort((a, b) => b[1].days - a[1].days);
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-background/40 p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">The days bank · entries made in the window</h3>
      <div className="relative overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-subtle">
            <th scope="col" className="pb-1 text-left font-medium">Days / entries</th>
            <th scope="col" className="whitespace-nowrap pb-1 pl-3 text-right font-medium">30d</th>
            <th scope="col" className="whitespace-nowrap pb-1 pl-3 text-right font-medium">All time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-border/40">
              <td className="py-1 pr-2 text-foreground">{row.label}</td>
              <td className={`${td} text-foreground`}>{row.d30}</td>
              <td className={`${td} text-muted`}>{row.all}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {sources.length > 0 ? (
        <p className="mt-2 text-xs text-muted">
          By source, all time: {sources.map(([k, v]) => `${SOURCE_LABEL[k] ?? k} ${v.days} d / ${v.entries}`).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
