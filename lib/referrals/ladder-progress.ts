import type { ReferralSummary } from "@/lib/referrals/summary";

// ---------------------------------------------------------------------------
// The viewer's place on the referral ladder, in ONE shape and ONE sentence
// (TODO SG4, owner 2026-11-06): the Refer a friend page's progress bar and
// the share dialog's line read the same words. Pure: the page builds it from
// its summary, /api/referrals/share from the viewer's rows.
// ---------------------------------------------------------------------------

export type LadderProgress = {
  /** Rewarded referrals — the viewer's rung. */
  rewardsEarned: number;
  /** Steps on the ladder (the settings' length) — the bar's end. */
  ladderLength: number;
  /** The next step's reward in words (the ladder's, or the tail past it). */
  nextRewardPhrase: string;
  /** Past the ladder: every further referral earns the tail. */
  pastLadder: boolean;
};

export function ladderProgressOf(
  summary: Pick<ReferralSummary, "rewardsEarned" | "ladderLength" | "nextRewardPhrase" | "pastLadder">,
): LadderProgress {
  return {
    rewardsEarned: summary.rewardsEarned,
    ladderLength: summary.ladderLength,
    nextRewardPhrase: summary.nextRewardPhrase,
    pastLadder: summary.pastLadder,
  };
}

/** The bar's fill, 0 … 1 (full past the ladder). */
export function ladderProgressFraction(progress: LadderProgress): number {
  if (progress.ladderLength <= 0) return 0;
  return Math.min(1, Math.max(0, progress.rewardsEarned / progress.ladderLength));
}

/** "2 of 10 referrals rewarded — next: 5 AI credits." — the one sentence. */
export function ladderProgressLine(progress: LadderProgress): string {
  const { rewardsEarned, ladderLength, nextRewardPhrase, pastLadder } = progress;
  if (rewardsEarned === 0) return `Your first referral earns ${nextRewardPhrase}.`;
  if (pastLadder) {
    return `${rewardsEarned} of ${ladderLength} referrals rewarded — every further one earns ${nextRewardPhrase}.`;
  }
  return `${rewardsEarned} of ${ladderLength} referrals rewarded — next: ${nextRewardPhrase}.`;
}
