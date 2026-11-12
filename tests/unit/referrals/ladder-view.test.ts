import { describe, expect, it } from "vitest";
import { LADDER_MIN_HEIGHT_PCT, buildLadderView, ladderTotalsPhrase } from "@/lib/referrals/ladder-view";
import { DEFAULT_REFERRAL_SETTINGS, type RewardStep } from "@/lib/referrals/settings";

// ---------------------------------------------------------------------------
// The referral ladder as the Refer a friend page draws it (owner 2026-11-11):
// a staircase, one column per referral, as tall as the free days banked by
// then. ONE measure on the axis — days — so a credits step is a flat tread;
// what was earned, what is still ahead and what the next referral gives are
// the settings' own sums.
// ---------------------------------------------------------------------------

const settings = DEFAULT_REFERRAL_SETTINGS; // 7d, 5cr, 7d, 10cr, 14d, 20cr, 21d, 50cr, 21d, 30d; tail 7d
const view = (earned: number, s = settings) => buildLadderView(s, earned);

describe("buildLadderView", () => {
  it("one step per ladder entry, numbered from 1, in the settings' words", () => {
    const { steps } = view(0);
    expect(steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(steps.map((s) => s.phrase)).toEqual([
      "7 free days", "5 AI credits", "7 free days", "10 AI credits", "14 free days",
      "20 AI credits", "21 free days", "50 AI credits", "21 free days", "30 free days",
    ]);
    expect(steps.map((s) => s.gain)).toEqual(["+7 days", "+5 credits", "+7 days", "+10 credits", "+14 days", "+20 credits", "+21 days", "+50 credits", "+21 days", "+30 days"]);
    expect(steps.map((s) => s.kind)).toEqual(["days", "credits", "days", "credits", "days", "credits", "days", "credits", "days", "days"]);
  });

  it("the stairs rise with the free days banked — a credits step is a flat tread, the last step is the top", () => {
    const { steps } = view(0);
    expect(steps.map((s) => s.cumulativeDays)).toEqual([7, 7, 14, 14, 28, 28, 49, 49, 70, 100]);
    // % of the ladder's 100 days, never under the floor.
    expect(steps.map((s) => s.heightPct)).toEqual([LADDER_MIN_HEIGHT_PCT, LADDER_MIN_HEIGHT_PCT, 14, 14, 28, 28, 49, 49, 70, 100]);
    // Never falls: each step is at least as tall as the one before.
    for (let i = 1; i < steps.length; i += 1) expect(steps[i].heightPct).toBeGreaterThanOrEqual(steps[i - 1].heightPct);
    // The height does not depend on what was earned.
    expect(view(4).steps.map((s) => s.heightPct)).toEqual(steps.map((s) => s.heightPct));
  });

  it("marks what is earned, the ONE next step, and what is to come", () => {
    expect(view(0).steps.map((s) => s.state)).toEqual(["next", ...Array(9).fill("upcoming")]);
    expect(view(3).steps.map((s) => s.state)).toEqual(["earned", "earned", "earned", "next", ...Array(6).fill("upcoming")]);
    expect(view(10).steps.map((s) => s.state)).toEqual(Array(10).fill("earned"));
    expect(view(14).steps.every((s) => s.state === "earned")).toBe(true);
  });

  it("adds up what was earned and what is still on the ladder — days and credits apart", () => {
    expect(view(0)).toMatchObject({ earned: { days: 0, credits: 0 }, ahead: { days: 100, credits: 85 }, nextPhrase: "7 free days", pastLadder: false });
    expect(view(4)).toMatchObject({ earned: { days: 14, credits: 15 }, ahead: { days: 86, credits: 70 }, nextPhrase: "14 free days", pastLadder: false });
    expect(view(10)).toMatchObject({ earned: { days: 100, credits: 85 }, ahead: { days: 0, credits: 0 }, nextPhrase: "7 free days", pastLadder: true });
    // Earned + ahead is always the whole ladder.
    for (let n = 0; n <= 10; n += 1) {
      const v = view(n);
      expect(v.earned.days + v.ahead.days).toBe(100);
      expect(v.earned.credits + v.ahead.credits).toBe(85);
    }
  });

  it("past the ladder every further referral earned the tail", () => {
    expect(view(13)).toMatchObject({ rewardsEarned: 13, earned: { days: 121, credits: 85 }, ahead: { days: 0, credits: 0 }, nextPhrase: "7 free days", tailPhrase: "7 free days", pastLadder: true });
    const creditsTail = { ...settings, tail: { kind: "credits", amount: 3 } as RewardStep };
    expect(view(12, creditsTail)).toMatchObject({ earned: { days: 100, credits: 91 }, nextPhrase: "3 AI credits", tailPhrase: "3 AI credits" });
    expect(view(12, { ...settings, tail: { kind: "none" } }).earned).toEqual({ days: 100, credits: 85 });
  });

  it("a ladder with no days at all is still a staircase: it rises evenly by step", () => {
    const credits: RewardStep[] = [{ kind: "credits", amount: 5 }, { kind: "credits", amount: 10 }, { kind: "none" }, { kind: "credits", amount: 20 }];
    const v = view(1, { ...settings, ladder: credits });
    expect(v.steps.map((s) => s.heightPct)).toEqual([25, 50, 75, 100]);
    expect(v.steps.map((s) => s.gain)).toEqual(["+5 credits", "+10 credits", "", "+20 credits"]);
    expect(v.steps[2]).toMatchObject({ kind: "none", phrase: "nothing" });
    expect(v).toMatchObject({ earned: { days: 0, credits: 5 }, ahead: { days: 0, credits: 30 } });
  });

  it("an empty ladder has no steps and is past itself: every referral earns the tail", () => {
    expect(view(0, { ...settings, ladder: [] })).toMatchObject({ steps: [], pastLadder: true, nextPhrase: "7 free days", earned: { days: 0, credits: 0 } });
    expect(view(2, { ...settings, ladder: [] }).earned).toEqual({ days: 14, credits: 0 });
  });

  it("a count that is not a whole number from 0 up reads as none earned — never a NaN on the page", () => {
    for (const odd of [-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const v = view(odd);
      expect(v.rewardsEarned).toBe(0);
      expect(v.steps[0].state).toBe("next");
      expect(v.earned).toEqual({ days: 0, credits: 0 });
    }
  });

  it("one day and one credit are singular", () => {
    const v = view(0, { ...settings, ladder: [{ kind: "days", days: 1 }, { kind: "credits", amount: 1 }] });
    expect(v.steps.map((s) => s.gain)).toEqual(["+1 day", "+1 credit"]);
  });
});

describe("ladderTotalsPhrase", () => {
  it("names days and credits, either alone, or the words for neither", () => {
    expect(ladderTotalsPhrase({ days: 14, credits: 5 })).toBe("14 free days and 5 AI credits");
    expect(ladderTotalsPhrase({ days: 1, credits: 1 })).toBe("1 free day and 1 AI credit");
    expect(ladderTotalsPhrase({ days: 7, credits: 0 })).toBe("7 free days");
    expect(ladderTotalsPhrase({ days: 0, credits: 85 })).toBe("85 AI credits");
    expect(ladderTotalsPhrase({ days: 0, credits: 0 })).toBe("nothing yet");
    expect(ladderTotalsPhrase({ days: 0, credits: 0 }, "All of it earned")).toBe("All of it earned");
  });
});
