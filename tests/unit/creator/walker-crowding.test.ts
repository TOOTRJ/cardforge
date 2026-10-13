import { describe, expect, it } from "vitest";
import { layoutProfileLoyaltyRows, loyaltyRowsDrawing } from "@/lib/cards/loyalty-rows";
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
  it.each([
    ["m15pw", 9],
    ["m15borderlesspw", 9],
    ["m15borderlesspwtall", 11],
  ])("%s: %i rows", (template, count) => {
    const profile = getFrameProfile(template);
    expect(firstCollidingRowCount(profile, ASPECT)).toBe(count);
    expect(walkerBadgesCollide(profile, rows(count - 1), ASPECT)).toBe(false);
    expect(walkerBadgesCollide(profile, rows(count), ASPECT)).toBe(true);
    expect(walkerBadgesCollide(profile, rows(13), ASPECT)).toBe(true);
  });

  it("is the layout's own arithmetic: neighbouring rows no further apart than a badge is tall", () => {
    const profile = getFrameProfile("m15pw");
    for (const count of [8, 9]) {
      const layout = layoutProfileLoyaltyRows(profile, rows(count), ASPECT);
      const { edges, row, boxHeight } = loyaltyRowsDrawing(layout, "hd");
      const pitch = (edges[2] - edges[0]) / 2;
      expect(pitch <= row.badgeHeight).toBe(count === 9);
      // (The rows stopped FITTING earlier: a row's minimum is its badge and
      // its padding.)
      expect(layout.clipped).toBe(true);
      expect(Math.round(boxHeight / count) < row.badgeHeight + 2 * row.padY).toBe(true);
    }
    expect(layoutProfileLoyaltyRows(profile, rows(6), ASPECT).clipped).toBe(false);
  });
});

describe("what does not count", () => {
  const profile = getFrameProfile("m15pw");

  it("a printed walker's rows", () => {
    for (const count of [1, 2, 3, 4, 6, 7]) expect(walkerBadgesCollide(profile, rows(count), ASPECT)).toBe(false);
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
