import { rewardStepPhrase, type ReferralSettings, type RewardStep } from "@/lib/referrals/settings";

// ---------------------------------------------------------------------------
// The referral ladder as the Refer a friend page DRAWS it (owner 2026-11-11:
// "I also want the ladder to be more flashy. Add a chart or animation to
// draw user attention to it"): a rising STAIRCASE, one column per referral,
// each as tall as the free days the viewer has banked by then. Pure — the
// page hands in the settings' ladder and how many referrals were rewarded;
// the component only draws this.
//
// ONE measure on the vertical axis: free days, running total. AI credits
// are a different unit, so a credits step adds no height (its tread is
// flat) and is drawn as a label on the step — never a second scale.
// ---------------------------------------------------------------------------

export type LadderStepState = "earned" | "next" | "upcoming";

export type LadderStepView = {
  /** The referral's number, 1-based. */
  n: number;
  kind: "days" | "credits" | "none";
  /** "7 free days", "5 AI credits", "nothing" — the settings' words. */
  phrase: string;
  /** The step's own reward, short: "+7 days", "+5 credits", "" for nothing. */
  gain: string;
  state: LadderStepState;
  /** Free days from the ladder through this step. */
  cumulativeDays: number;
  /** The column's height, 0 … 100 (% of the ladder's top). */
  heightPct: number;
};

export type LadderTotals = { days: number; credits: number };

export type LadderView = {
  steps: LadderStepView[];
  /** What every referral past the ladder earns, in the settings' words. */
  tailPhrase: string;
  /** Rewarded referrals (the viewer's rung; may pass the ladder's length). */
  rewardsEarned: number;
  /** What the rewarded steps gave — the ladder's and, past it, the tail's. */
  earned: LadderTotals;
  /** What is still on the ladder's steps. */
  ahead: LadderTotals;
  /** The next reward, in the settings' words (the tail's past the ladder). */
  nextPhrase: string;
  pastLadder: boolean;
};

/** The lowest column: a 7-day first step on a 100-day ladder would be a
 *  sliver, and an all-credits ladder would have no height at all. */
export const LADDER_MIN_HEIGHT_PCT = 12;

const daysOf = (step: RewardStep): number => (step.kind === "days" ? step.days : 0);
const creditsOf = (step: RewardStep): number => (step.kind === "credits" ? step.amount : 0);

function gainOf(step: RewardStep): string {
  if (step.kind === "days") return `+${step.days} day${step.days === 1 ? "" : "s"}`;
  if (step.kind === "credits") return `+${step.amount} credit${step.amount === 1 ? "" : "s"}`;
  return "";
}

/** "14 free days and 5 AI credits", "7 free days", "5 AI credits", or
 *  `empty` when there is neither. */
export function ladderTotalsPhrase(totals: LadderTotals, empty = "nothing yet"): string {
  const parts: string[] = [];
  if (totals.days > 0) parts.push(`${totals.days} free day${totals.days === 1 ? "" : "s"}`);
  if (totals.credits > 0) parts.push(`${totals.credits} AI credit${totals.credits === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" and ") : empty;
}

export function buildLadderView(
  settings: Pick<ReferralSettings, "ladder" | "tail">,
  rewardsEarned: number,
): LadderView {
  const earnedCount = Number.isInteger(rewardsEarned) && rewardsEarned > 0 ? rewardsEarned : 0;
  const ladder = settings.ladder;
  const totalDays = ladder.reduce((sum, step) => sum + daysOf(step), 0);

  let runningDays = 0;
  const steps: LadderStepView[] = ladder.map((step, index) => {
    const n = index + 1;
    runningDays += daysOf(step);
    // The stair rises with the days banked; a ladder with no days at all
    // rises evenly by step instead, so it is still a staircase.
    const share = totalDays > 0 ? runningDays / totalDays : n / ladder.length;
    return {
      n,
      kind: step.kind,
      phrase: rewardStepPhrase(step),
      gain: gainOf(step),
      state: n <= earnedCount ? "earned" : n === earnedCount + 1 ? "next" : "upcoming",
      cumulativeDays: runningDays,
      heightPct: Math.round(Math.max(LADDER_MIN_HEIGHT_PCT, share * 100)),
    };
  });

  const earned: LadderTotals = { days: 0, credits: 0 };
  const ahead: LadderTotals = { days: 0, credits: 0 };
  ladder.forEach((step, index) => {
    const bucket = index < earnedCount ? earned : ahead;
    bucket.days += daysOf(step);
    bucket.credits += creditsOf(step);
  });
  // Past the ladder every further referral earned the tail.
  const pastLadder = earnedCount >= ladder.length;
  const extra = Math.max(0, earnedCount - ladder.length);
  earned.days += extra * daysOf(settings.tail);
  earned.credits += extra * creditsOf(settings.tail);

  return {
    steps,
    tailPhrase: rewardStepPhrase(settings.tail),
    rewardsEarned: earnedCount,
    earned,
    ahead,
    nextPhrase: rewardStepPhrase(ladder[earnedCount] ?? settings.tail),
    pastLadder,
  };
}
