import type { PaidTier } from "@/lib/billing/plans";
import type { RewardSpec } from "@/lib/referrals/settings";

// ---------------------------------------------------------------------------
// What one side of a referral is given (owner 2026-11-05): the settings'
// reward spec made concrete for the user — pure. "Free days" are then
// lib/billing/free-days.ts's business (the one mechanism comps use: added to
// a paying plan's time, the perks overlay otherwise, nothing below the plan
// paid for); credits are one grant_credits call.
//
//   tier "own" (the referrer's side): the tier they PAY for while their plan
//   is live (active or trialing), else Plus — a free account's reward is
//   Plus, a Pro payer's reward is Pro days (owner 2026-11-05).
// ---------------------------------------------------------------------------

export type ReferralRewardProfile = {
  is_admin?: boolean | null;
  subscription_tier?: string | null;
  subscription_status?: string | null;
  /** Read for the shared-card fraud rule (lib/referrals/server.ts), not the reward. */
  stripe_customer_id?: string | null;
};

export type ReferralReward =
  | { kind: "free_days"; tier: PaidTier; units: number }
  | { kind: "credits"; amount: number }
  | { kind: "none"; reason: "admin" | "settings" };

const LIVE = new Set(["active", "trialing"]);

export function referralRewardFor(spec: RewardSpec, profile: ReferralRewardProfile): ReferralReward {
  if (profile.is_admin) return { kind: "none", reason: "admin" };
  switch (spec.kind) {
    case "free_days": {
      const paid = profile.subscription_tier === "plus" || profile.subscription_tier === "pro" ? profile.subscription_tier : null;
      const own = LIVE.has(profile.subscription_status ?? "") && paid ? paid : "plus";
      return { kind: "free_days", tier: spec.tier === "own" ? own : spec.tier, units: spec.units };
    }
    case "credits":
      return { kind: "credits", amount: spec.amount };
    default:
      return { kind: "none", reason: "settings" };
  }
}
