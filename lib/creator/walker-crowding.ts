// ---------------------------------------------------------------------------
// A planeswalker with so many ability rows that its loyalty badges run into
// each other (the TODO 3b.25 follow-up, 2026-10-13) — what the row editor's
// "this card will be crowded" note reads. A READER of the walker layout
// (lib/cards/loyalty-rows.ts), never a second one: no renderer changes.
//
// Both renderers draw a badge box `badgeHeight` tall, centred on its row
// (align-items: center, flex-shrink: 0), in the whole-px rows of
// loyaltyRowsDrawing. A row's minimum is one badge and its padding; once the
// rows no longer fit at the ladder's floor they are scaled into the box
// alike (LoyaltyRowsLayout.clipped), and from the row count where two
// neighbouring rows' centres are no further apart than a badge is tall, the
// two badges touch or overlap. That is read here from the rows the card
// really gets — its frame's box, its texts — at both bake targets; a static
// ability draws no badge, so only neighbours that both have a cost count.
//
// With one-line abilities, each with a cost, it starts where the box's
// height over the row count is no more than a badge (69 px at HD): 9 rows on
// m15pw and the regular borderless walker (a 594 px box; 8 rows are 74 px
// each), 11 on the tall borderless one (732 px). The rows stop FITTING
// earlier — 7 and 9: a row's minimum is its badge and padding, 89 px — and
// longer texts bring both points down, which is why the card's own rows are
// laid out rather than a count compared.
// tests/unit/creator/walker-crowding.test.ts holds the numbers to the
// profiles, so a re-cut box moves them with it.
// Pure: no form, no React.
// ---------------------------------------------------------------------------

import type { LoyaltyAbility } from "@/lib/cards/card-display";
import { layoutProfileLoyaltyRows, loyaltyRowsDrawing, type LoyaltyRowsLayout } from "@/lib/cards/loyalty-rows";
import { RULES_TARGETS } from "@/lib/cards/rules-layout";
import type { FrameProfile } from "@/lib/cards/template-layout";

/** Whether two neighbouring badges of `rows` touch or overlap at either
 *  bake target. `abilities` are the rows' own (a null cost = no badge). */
export function loyaltyBadgesCollide(
  rows: Pick<LoyaltyRowsLayout, "rowFractions" | "text">,
  abilities: readonly Pick<LoyaltyAbility, "cost">[],
): boolean {
  if (rows.rowFractions.length < 2) return false;
  return RULES_TARGETS.some((target) => {
    const { edges, row } = loyaltyRowsDrawing(rows as LoyaltyRowsLayout, target);
    const centre = (i: number) => (edges[i] + edges[i + 1]) / 2;
    return abilities.some(
      (ability, i) =>
        i + 1 < abilities.length &&
        Boolean(ability.cost) &&
        Boolean(abilities[i + 1]?.cost) &&
        centre(i + 1) - centre(i) <= row.badgeHeight,
    );
  });
}

/** The same for a card: its frame's profile (null / no walker rows: never),
 *  the abilities it draws, its aspect. */
export function walkerBadgesCollide(
  profile: Pick<FrameProfile, "rules" | "loyalty" | "loyaltyRows" | "symbolStyle"> | null | undefined,
  abilities: readonly LoyaltyAbility[],
  aspect: number,
): boolean {
  if (!profile?.loyaltyRows || abilities.length < 2) return false;
  return loyaltyBadgesCollide(layoutProfileLoyaltyRows(profile, abilities, aspect), abilities);
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
