import type { ReferralStatus } from "@/lib/referrals/rules";
import type { ReferralSettings } from "@/lib/referrals/settings";

// ---------------------------------------------------------------------------
// The referral dashboard's numbers, from the viewer's own rows — pure, so the
// progress ("2 of 3 this month") is a unit test. "This month" is the UTC
// calendar month, the same month claim_referral_reward() counts (0177).
// ---------------------------------------------------------------------------

export type ReferralRow = {
  id: string;
  username: string | null;
  /** The friend deleted their account (the row stays: 0177's SET NULL). */
  accountDeleted?: boolean;
  status: ReferralStatus;
  signedUpAt: string;
  firstCardAt: string | null;
  rewardedAt: string | null;
  /** What the VIEWER (the referrer) got for it. */
  reward: "free_days" | "credits" | null;
};

export type ReferralSummary = {
  joined: number;
  activated: number;
  rewardsEarned: number;
  /** Rewards earned this UTC month, against the monthly cap. */
  thisMonth: number;
  monthlyCap: number;
  lifetimeCap: number;
  /** The lifetime cap is reached: friends still get theirs. */
  lifetimeReached: boolean;
};

export function buildReferralSummary(
  rows: readonly ReferralRow[],
  caps: ReferralSettings["caps"],
  now: Date = new Date(),
): ReferralSummary {
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const earned = rows.filter((r) => r.status === "rewarded");
  const rewardsEarned = earned.length;
  return {
    joined: rows.length,
    activated: rows.filter((r) => r.firstCardAt != null).length,
    rewardsEarned,
    thisMonth: earned.filter((r) => r.rewardedAt != null && Date.parse(r.rewardedAt) >= monthStart).length,
    monthlyCap: caps.perMonth,
    lifetimeCap: caps.lifetime,
    lifetimeReached: rewardsEarned >= caps.lifetime,
  };
}
