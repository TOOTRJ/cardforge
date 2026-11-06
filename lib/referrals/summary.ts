import type { ReferralStatus } from "@/lib/referrals/rules";
import { ladderRewardFor, rewardStepPhrase, type ReferralSettings, type RewardStep } from "@/lib/referrals/settings";

// ---------------------------------------------------------------------------
// The referral dashboard's numbers, from the viewer's own rows — pure, so
// the ladder's progress ("3 rewards earned — next: 10 AI credits") is a
// unit test. "This month" is the UTC calendar month, the same month
// claim_referral_reward_v2() counts the friends cap in (0180).
// ---------------------------------------------------------------------------

export type ReferralRow = {
  id: string;
  username: string | null;
  /** The friend deleted their account (the row stays: 0177's SET NULL). */
  accountDeleted?: boolean;
  status: ReferralStatus;
  signedUpAt: string;
  /** The friend saved the required cards. */
  cardsSavedAt: string | null;
  /** The friend started a plan with a card on file. */
  cardOnFileAt: string | null;
  rewardedAt: string | null;
  /** The ladder step this referral gave the viewer (rewarded rows). */
  ladderStep: number | null;
  /** What the VIEWER (the referrer) got for it. */
  reward: "banked_days" | "free_days" | "credits" | null;
};

export type ReferralSummary = {
  joined: number;
  /** Friends who saved the required cards. */
  cardsSaved: number;
  /** Friends who also put a card on file (a plan started). */
  cardOnFile: number;
  /** Rewarded referrals — the viewer's rung on the ladder. */
  rewardsEarned: number;
  /** Friends rewarded this UTC month, against the friends cap. */
  friendsThisMonth: number;
  friendsPerMonth: number;
  /** The next step's reward (the ladder's, or the tail past it). */
  nextReward: RewardStep;
  nextRewardPhrase: string;
  /** Steps on the ladder (its length) — the progress bar's end. */
  ladderLength: number;
  /** The viewer is past the ladder: every further referral earns the tail. */
  pastLadder: boolean;
};

export function buildReferralSummary(
  rows: readonly ReferralRow[],
  settings: Pick<ReferralSettings, "ladder" | "tail" | "caps">,
  now: Date = new Date(),
): ReferralSummary {
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const rewarded = rows.filter((r) => r.status === "rewarded");
  const rewardsEarned = rewarded.length;
  const nextStep = rewardsEarned + 1;
  const nextReward = ladderRewardFor(settings, nextStep);
  return {
    joined: rows.length,
    cardsSaved: rows.filter((r) => r.cardsSavedAt != null).length,
    cardOnFile: rows.filter((r) => r.cardOnFileAt != null).length,
    rewardsEarned,
    friendsThisMonth: rows.filter(
      (r) =>
        (r.status === "rewarded" || r.status === "capped" || r.status === "blocked") &&
        r.rewardedAt != null &&
        Date.parse(r.rewardedAt) >= monthStart,
    ).length,
    friendsPerMonth: settings.caps.friendsPerMonth,
    nextReward,
    nextRewardPhrase: rewardStepPhrase(nextReward),
    ladderLength: settings.ladder.length,
    pastLadder: rewardsEarned >= settings.ladder.length,
  };
}
