import { TIER_RANK, type BillingPeriod, type PaidTier, type PlanTier } from "@/lib/billing/plans";

/**
 * A downgrade is a lower tier, or the same tier from annual to monthly.
 * Upgrades apply at once (the portal confirm flow charges the prorated
 * difference); downgrades wait for the END of the paid period so the
 * customer keeps what they paid for — the standard SaaS behaviour, and what
 * the portal's own `schedule_at_period_end` does, except that Stripe only
 * schedules within ONE product there: Pro → Plus (two products) has to be
 * scheduled by the app (lib/stripe/actions.ts scheduleDowngrade). An
 * unresolvable current price is treated as an upgrade: the portal shows the
 * proration either way. Pure and client-safe (a "use server" module may only
 * export async functions).
 */
export function isPlanDowngrade(
  current: { tier: PlanTier | null; interval: string | null | undefined },
  target: { tier: PaidTier; period: BillingPeriod },
): boolean {
  if (current.tier == null) return false;
  const rankNow = TIER_RANK[current.tier];
  const rankTarget = TIER_RANK[target.tier];
  if (rankTarget !== rankNow) return rankTarget < rankNow;
  return current.interval === "year" && target.period === "monthly";
}
