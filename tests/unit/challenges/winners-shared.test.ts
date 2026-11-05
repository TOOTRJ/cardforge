import { describe, expect, it } from "vitest";
import {
  challengeWinAward,
  isWinnerPlace,
  placeLabel,
  winnerErrorMessage,
} from "@/lib/challenges/winners-shared";

describe("challenge winners — the words (TODO NV12)", () => {
  it("names each place", () => {
    expect([1, 2, 3].map((p) => placeLabel(p as 1 | 2 | 3))).toEqual(["1st place", "2nd place", "3rd place"]);
  });

  it("knows only the three places", () => {
    expect([0, 1, 2, 3, 4, "1", null].map(isWinnerPlace)).toEqual([false, true, true, true, false, false, false]);
  });

  it("says the award the card page and its JSON-LD carry", () => {
    expect(challengeWinAward({ place: 2, challenge: { slug: "tiny-titans", title: "Tiny Titans" } })).toBe(
      "2nd place, Tiny Titans design challenge",
    );
  });

  it("turns the database's refusals into sentences, and passes anything else through", () => {
    expect(winnerErrorMessage('P0001: challenge_not_closed')).toMatch(/once the challenge has closed/);
    expect(winnerErrorMessage("not_a_challenge_entry")).toMatch(/no longer an entry/);
    expect(winnerErrorMessage("duplicate_winner")).toBe("A card can only take one place.");
    expect(winnerErrorMessage("network down")).toBe("network down");
  });
});
