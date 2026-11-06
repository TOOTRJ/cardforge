import { ladderRewardFor, type ReferralSettings, type RewardStep } from "@/lib/referrals/settings";

// ---------------------------------------------------------------------------
// What one side of a referral is given (owner 2026-11-06): the settings made
// concrete — pure. Days go into the DAYS BANK (lib/billing/day-bank.ts: a
// free period the user applies with a card on file), credits are one
// grant_credits call. The bank is tier-less, so a reward has no tier.
//
//   the friend    `friend.days` banked when the referral qualifies;
//   the referrer  the ladder's step for their N-th qualified referral, the
//                 tail past it.
// An admin account gets nothing (every perk and unlimited credits already).
// ---------------------------------------------------------------------------

export type ReferralRewardProfile = {
  is_admin?: boolean | null;
  subscription_tier?: string | null;
  subscription_status?: string | null;
  /** Read for the shared-card fraud rule (lib/referrals/server.ts), not the reward. */
  stripe_customer_id?: string | null;
};

export type ReferralReward =
  | { kind: "days"; days: number }
  | { kind: "credits"; amount: number }
  | { kind: "none"; reason: "admin" | "settings" };

function concrete(step: RewardStep, profile: ReferralRewardProfile): ReferralReward {
  if (profile.is_admin) return { kind: "none", reason: "admin" };
  switch (step.kind) {
    case "days":
      return step.days > 0 ? { kind: "days", days: step.days } : { kind: "none", reason: "settings" };
    case "credits":
      return { kind: "credits", amount: step.amount };
    default:
      return { kind: "none", reason: "settings" };
  }
}

/** The friend's reward. */
export function friendRewardFor(settings: Pick<ReferralSettings, "friend">, profile: ReferralRewardProfile): ReferralReward {
  return concrete({ kind: "days", days: settings.friend.days }, profile);
}

/** The referrer's reward for their N-th qualified referral (1-based). */
export function referrerRewardFor(
  settings: Pick<ReferralSettings, "ladder" | "tail">,
  step: number,
  profile: ReferralRewardProfile,
): ReferralReward {
  return concrete(ladderRewardFor(settings, step), profile);
}
