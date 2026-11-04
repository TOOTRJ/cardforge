import { describe, expect, it } from "vitest";
import { LIKE_RANK_MIN_LIKES, LIKE_RANK_SHOWN_TOP, likeStandingText } from "@/lib/cards/like-standing";

// ---------------------------------------------------------------------------
// The card page's "most-liked" line (TODO CP3): shown only near the top
// (within the first 50 places, 3 likes or more from other people), and a
// shared place says so. The ranking itself is 0168's card_like_standing.
// ---------------------------------------------------------------------------

describe("likeStandingText", () => {
  it("names the place, and says when it is shared", () => {
    expect(likeStandingText({ rank: 1, tied: false, likes: 12 })).toBe("#1 most-liked card");
    expect(likeStandingText({ rank: 2, tied: true, likes: 3 })).toBe("Tied for #2 most-liked card");
  });

  it("says nothing past the top places or under the like floor", () => {
    expect(LIKE_RANK_SHOWN_TOP).toBe(50);
    expect(LIKE_RANK_MIN_LIKES).toBe(3);
    expect(likeStandingText({ rank: 50, tied: false, likes: 3 })).toBe("#50 most-liked card");
    expect(likeStandingText({ rank: 51, tied: false, likes: 40 })).toBeNull();
    expect(likeStandingText({ rank: 1, tied: false, likes: 2 })).toBeNull();
    // Production 2026-11-03: 98 cards with one like each read "#23".
    expect(likeStandingText({ rank: 23, tied: true, likes: 1 })).toBeNull();
  });

  it("nothing for no standing or a nonsense one", () => {
    expect(likeStandingText(null)).toBeNull();
    expect(likeStandingText({ rank: 0, tied: false, likes: 9 })).toBeNull();
    expect(likeStandingText({ rank: 1.5, tied: false, likes: 9 })).toBeNull();
  });
});
