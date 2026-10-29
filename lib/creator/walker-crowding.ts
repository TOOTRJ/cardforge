// ---------------------------------------------------------------------------
// A planeswalker with so many ability rows that its loyalty badges run into
// each other (the TODO 3b.25 follow-up, 2026-10-13) — what the row editor's
// "this card will be crowded" note reads. A READER of the walker layout
// (lib/cards/loyalty-rows.ts), never a second one: no renderer changes.
//
// Both renderers draw each badge where print draws it (layout v75,
// lib/cards/loyalty-rows.ts loyaltyBadgesDrawing): on its row's centre, a
// "+" riding high and a "−" low, in the whole-px rows of loyaltyRowsDrawing.
// Two neighbouring badges MEET when their silver rims touch
// (loyaltyBadgesMeet — the layout steps its size down first where a smaller
// size parts them; equal one-line rows are as far apart at every size, so
// those meet whatever the size). That is read here from the rows the card
// really gets — its frame's box, its texts — at both bake targets; a static
// ability draws no badge, so only neighbours that both have a cost count.
//
// With EQUAL one-line abilities, each with a cost, it starts where the rows
// are closer than a "+" badge's rim is tall (108 px at HD): from 6 rows on
// m15pw and the regular borderless walker (a 594 px box: 99 px each), 7 on
// the tall borderless one (732 px: 105). MIXED rows reach it from about 5
// (a long ability takes the room its short neighbours' badges need) — which
// is why the card's own rows are laid out rather than a count compared. No
// printed walker has that many rows.
// tests/unit/creator/walker-crowding.test.ts holds the numbers to the
// profiles, so a re-cut box moves them with it.
// Pure: no form, no React.
// ---------------------------------------------------------------------------

import type { LoyaltyAbility } from "@/lib/cards/card-display";
import { layoutProfileLoyaltyRows, loyaltyBadgesMeet, type LoyaltyRowsLayout } from "@/lib/cards/loyalty-rows";
import type { FrameProfile, Rect } from "@/lib/cards/template-layout";

/** Whether two neighbouring badges of `rows` touch or overlap at either
 *  bake target. `abilities` are the rows' own (a null cost = no badge). */
export function loyaltyBadgesCollide(
  rows: Pick<LoyaltyRowsLayout, "rowFractions" | "text">,
  abilities: readonly Pick<LoyaltyAbility, "cost">[],
): boolean {
  return loyaltyBadgesMeet(rows, abilities);
}

/** The same for a card: its frame's profile (null / no walker rows: never),
 *  the abilities it draws, its aspect — and, where the caller knows it, the
 *  holofoil stamp's arch the rows keep out of (rowsStampKeepOut: the
 *  borderless walkers), so the note judges the very layout the bake draws.
 *  Without it the rows are the unstamped ones. */
export function walkerBadgesCollide(
  profile: Pick<FrameProfile, "rules" | "loyalty" | "loyaltyRows" | "symbolStyle"> | null | undefined,
  abilities: readonly LoyaltyAbility[],
  aspect: number,
  stamp: readonly Rect[] | null = null,
): boolean {
  if (!profile?.loyaltyRows || abilities.length < 2) return false;
  return loyaltyBadgesCollide(layoutProfileLoyaltyRows(profile, abilities, aspect, stamp), abilities);
}

/** The first row count at which a walker of one-line abilities, each with a
 *  cost, has colliding badges on `profile` — the number the note's point is
 *  reported as (and tested at). Null when none up to `max`. */
export function firstCollidingRowCount(
  profile: Pick<FrameProfile, "rules" | "loyalty" | "loyaltyRows" | "symbolStyle">,
  aspect: number,
  max = 20,
): number | null {
  for (let count = 2; count <= max; count += 1) {
    const abilities = Array.from({ length: count }, () => ({ cost: "+1", text: "Draw a card." }));
    if (walkerBadgesCollide(profile, abilities, aspect)) return count;
  }
  return null;
}
