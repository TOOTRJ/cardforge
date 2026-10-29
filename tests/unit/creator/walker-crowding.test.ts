import { describe, expect, it } from "vitest";
import { layoutProfileLoyaltyRows, loyaltyBadgesDrawing } from "@/lib/cards/loyalty-rows";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { firstCollidingRowCount, loyaltyBadgesCollide, walkerBadgesCollide } from "@/lib/creator/walker-crowding";

// ---------------------------------------------------------------------------
// Where a walker's loyalty badges run into each other (the TODO 3b.25
// follow-up, 2026-10-13): read from the walker layout both renderers draw —
// the row editor's "the card will be crowded" note. No renderer changes; the
// numbers below move with a profile's rules box, never by themselves.
// ---------------------------------------------------------------------------

const ASPECT = 7 / 5;
const rows = (count: number, cost: string | null = "+1") =>
  Array.from({ length: count }, () => ({ cost, text: "Draw a card." }));

describe("the row count where one-line abilities' badges touch", () => {
  // Layout v75: the badges at print's size (a "+" rim 108 px tall, 36 px
  // below its row's centre and 72 above) meet once the rows are closer
  // than 108 px — 6 rows of the 594 px box (99 px), 7 of the tall 732 px
  // one (105). (69 px badges met at 9 and 11 rows.)
  it.each([
    ["m15pw", 6],
    ["m15borderlesspw", 6],
    ["m15borderlesspwtall", 7],
  ])("%s: %i rows", (template, count) => {
    const profile = getFrameProfile(template);
    expect(firstCollidingRowCount(profile, ASPECT)).toBe(count);
    expect(walkerBadgesCollide(profile, rows(count - 1), ASPECT)).toBe(false);
    expect(walkerBadgesCollide(profile, rows(count), ASPECT)).toBe(true);
    expect(walkerBadgesCollide(profile, rows(13), ASPECT)).toBe(true);
  });

  it("is the layout's own arithmetic: two neighbouring badges' silver rims, where the rows put them", () => {
    const profile = getFrameProfile("m15pw");
    for (const count of [5, 6]) {
      const layout = layoutProfileLoyaltyRows(profile, rows(count), ASPECT);
      const [a, b] = loyaltyBadgesDrawing(layout, rows(count), "hd");
      expect(b.rim.top <= a.rim.bottom).toBe(count === 6);
      // The text still fits: equal one-line rows are as far apart at every
      // size, so the layout keeps its size and the note says so.
      expect(layout.clipped).toBe(false);
      expect(layout.sizePx).toBe(64);
    }
  });
});

describe("what does not count", () => {
  const profile = getFrameProfile("m15pw");

  it("a printed walker's rows", () => {
    for (const count of [1, 2, 3, 4, 5]) expect(walkerBadgesCollide(profile, rows(count), ASPECT)).toBe(false);
  });

  it("static abilities: they draw no badge", () => {
    expect(walkerBadgesCollide(profile, rows(13, null), ASPECT)).toBe(false);
    // …and a badge between two statics has no neighbour to touch.
    const alternating = Array.from({ length: 13 }, (_, i) => ({ cost: i % 2 ? "+1" : null, text: "Draw a card." }));
    expect(walkerBadgesCollide(profile, alternating, ASPECT)).toBe(false);
  });

  it("a frame with no walker rows, no rows at all", () => {
    expect(walkerBadgesCollide(getFrameProfile("m15"), rows(13), ASPECT)).toBe(false);
    expect(walkerBadgesCollide(null, rows(13), ASPECT)).toBe(false);
    expect(loyaltyBadgesCollide({ rowFractions: [], text: [] }, [])).toBe(false);
  });

  it("long abilities squeeze the short rows sooner: the card's own rows are laid out, not counted", () => {
    const long = "Until your next turn, whenever a creature an opponent controls attacks, it gets -1/-0 and you gain 1 life. ".repeat(3);
    const mixed = [...rows(6), { cost: "-3", text: long }, { cost: "-8", text: long }];
    expect(mixed).toHaveLength(8);
    expect(walkerBadgesCollide(profile, mixed, ASPECT)).toBe(true);
  });
});
