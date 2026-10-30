import { REFERRAL_LIFETIME_CAP, REFERRAL_MONTHLY_CAP, type ReferralStatus } from "@/lib/referrals/rules";

// ---------------------------------------------------------------------------
// The referral dashboard's numbers, from the viewer's own rows — pure, so the
// progress ("2 of 3 this month") is a unit test. "This month" is the UTC
// calendar month, the same month claim_referral_reward() counts (0153).
// ---------------------------------------------------------------------------

export type ReferralRow = {
  id: string;
  username: string | null;
  status: ReferralStatus;
  signedUpAt: string;
  firstCardAt: string | null;
  rewardedAt: string | null;
  /** What the VIEWER (the referrer) got for it. */
  reward: "comp_month" | "balance_credit" | null;
};

export type ReferralSummary = {
  joined: number;
  activated: number;
  monthsEarned: number;
  /** Months earned this UTC month, against the monthly cap. */
  thisMonth: number;
  monthlyCap: number;
  lifetimeCap: number;
  /** The lifetime cap is reached: friends still get their month. */
  lifetimeReached: boolean;
};

export function buildReferralSummary(rows: readonly ReferralRow[], now: Date = new Date()): ReferralSummary {
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const earned = rows.filter((r) => r.status === "rewarded");
  const monthsEarned = earned.length;
  return {
    joined: rows.length,
    activated: rows.filter((r) => r.firstCardAt != null).length,
    monthsEarned,
    thisMonth: earned.filter((r) => r.rewardedAt != null && Date.parse(r.rewardedAt) >= monthStart).length,
    monthlyCap: REFERRAL_MONTHLY_CAP,
    lifetimeCap: REFERRAL_LIFETIME_CAP,
    lifetimeReached: monthsEarned >= REFERRAL_LIFETIME_CAP,
  };
}
