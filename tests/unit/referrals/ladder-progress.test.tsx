// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ladderProgressFraction, ladderProgressLine, ladderProgressOf } from "@/lib/referrals/ladder-progress";
import { LadderProgressBar } from "@/components/referrals/ladder-progress";
import { buildReferralSummary } from "@/lib/referrals/summary";
import { DEFAULT_REFERRAL_SETTINGS } from "@/lib/referrals/settings";

// ---------------------------------------------------------------------------
// The ladder's progress (TODO SG4): one shape from the summary, one sentence
// for the Refer a friend page's bar and the share dialog, the bar an
// accessible progressbar named by that sentence.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

const row = (id: string, status: "rewarded" | "signed_up") => ({
  id,
  username: null,
  status,
  signedUpAt: "2026-11-01T00:00:00.000Z",
  cardsSavedAt: null,
  rewardedAt: status === "rewarded" ? "2026-11-02T00:00:00.000Z" : null,
  ladderStep: null,
  reward: null,
});

describe("ladderProgressOf + ladderProgressLine", () => {
  it("no reward yet: the first step's words; on the ladder: rung of length and the next step; past it: the tail", () => {
    const settings = DEFAULT_REFERRAL_SETTINGS;
    const none = ladderProgressOf(buildReferralSummary([row("a", "signed_up")], settings));
    expect(none).toEqual({ rewardsEarned: 0, ladderLength: settings.ladder.length, nextRewardPhrase: expect.any(String), pastLadder: false });
    expect(ladderProgressLine(none)).toMatch(/^Your first referral earns .+\.$/);

    const two = ladderProgressOf(buildReferralSummary([row("a", "rewarded"), row("b", "rewarded"), row("c", "signed_up")], settings));
    expect(two.rewardsEarned).toBe(2);
    expect(ladderProgressLine(two)).toBe(`2 of ${settings.ladder.length} referrals rewarded — next: ${two.nextRewardPhrase}.`);
    expect(ladderProgressFraction(two)).toBeCloseTo(2 / settings.ladder.length);

    const rows = Array.from({ length: settings.ladder.length + 2 }, (_, i) => row(`r${i}`, "rewarded"));
    const past = ladderProgressOf(buildReferralSummary(rows, settings));
    expect(past.pastLadder).toBe(true);
    expect(ladderProgressLine(past)).toBe(
      `${rows.length} of ${settings.ladder.length} referrals rewarded — every further one earns ${past.nextRewardPhrase}.`,
    );
    expect(ladderProgressFraction(past)).toBe(1);
  });

  it("an empty ladder never divides by zero", () => {
    expect(ladderProgressFraction({ rewardsEarned: 3, ladderLength: 0, nextRewardPhrase: "7 free days", pastLadder: true })).toBe(0);
  });
});

describe("LadderProgressBar", () => {
  it("is a progressbar named by the sentence, valued at the rung against the ladder's length, filled to match", () => {
    render(<LadderProgressBar progress={{ rewardsEarned: 3, ladderLength: 10, nextRewardPhrase: "10 AI credits", pastLadder: false }} />);
    const bar = screen.getByRole("progressbar", { name: "3 of 10 referrals rewarded — next: 10 AI credits." });
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("10");
    expect(bar.getAttribute("aria-valuenow")).toBe("3");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("30%");
    // The visible sentence is the bar's name, said once.
    expect(screen.getByText("3 of 10 referrals rewarded — next: 10 AI credits.").getAttribute("aria-hidden")).toBe("true");
  });

  it("past the ladder the bar is full and the value is capped at the length", () => {
    render(<LadderProgressBar progress={{ rewardsEarned: 12, ladderLength: 10, nextRewardPhrase: "7 free days", pastLadder: true }} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("10");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("100%");
  });
});
