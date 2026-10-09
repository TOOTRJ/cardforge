// ---------------------------------------------------------------------------
// The Variations section's "Legendary" entry (TODO 3b.17, owner 2026-10-09):
// "the legendary crown version of the selected frame". It is NOT a template
// and not a second value: it reads and writes the ONE crown switch,
// `frame_style.crown` (lib/cards/anatomy.ts — an addition, opt-in per card),
// and the word "Legendary" in the supertype. This file is the one place that
// answers, for the creator's form values:
//
//   • is the entry OFFERED — the frame the card is saved on declares a crown
//     (its PROFILES entry: an overlay band or crowned masters), and a face of
//     the card would draw it with the switch on and the word on its type
//     line (the card type prints one — never a planeswalker, token, battle
//     or emblem — and the crown is published in the colour it would paint);
//   • is it SELECTED — the switch is exactly `true` AND a face draws the
//     crown now (the word is there). So a card that is not legendary never
//     reads as selected, whatever its switch holds (a new card starts with
//     the switch on, NEW_CARD_ANATOMY);
//   • is the anatomy panel's "Legendary crown" switch SHOWN — the entry is
//     offered and a face has the word. While it shows, its on/off IS
//     `selected`: the two controls are one state and cannot disagree;
//   • which face takes the word when the entry is picked on a card with no
//     legendary face (prints: every crowned card is legendary) — on a NEW
//     card only: an edit's or a remix's type line is locked, so there the
//     entry is disabled on a card that is not legendary, and says why.
//
// Un-picking only turns the switch off: the word stays (a legendary card
// without the crown is every pre-2018 legendary print).
//
// Pure and client-safe.
// ---------------------------------------------------------------------------

import { frameAnatomyOf, qualifiesForCrown } from "@/lib/cards/anatomy";
import { supertypeHasWord, supertypeWords } from "@/lib/cards/card-display";
import { crownKeyFor } from "@/lib/cards/crown";
import { DEFAULT_DFC_ICON, bodyFor, dfcBodyOf, isDfcIconFamily } from "@/lib/cards/dfc";
import { getFrameProfile } from "@/lib/cards/template-layout";
import type { CardType, ColorIdentity, FrameTemplate } from "@/types/card";

/** The form values the entry is judged on (FormValues, reshaped). */
export type LegendaryVariationInput = {
  template: FrameTemplate | string | null | undefined;
  cardType: string | null | undefined;
  supertype: string | null | undefined;
  colorIdentity: readonly ColorIdentity[] | null | undefined;
  cost?: string | null;
  /** `frame_style.crown` as the form holds it. */
  crown: unknown;
  /** `frame_style.twoColor`: a pair drawn as its pair master wears the
   *  pair's crown. */
  twoColor?: unknown;
  /** A double-faced card's back face (the ONE crown switch serves both
   *  faces, TODO 5.1d): the family picks the back body. */
  dfcIcon?: unknown;
  backCardType?: string | null;
  backSupertype?: string | null;
  /** An EDIT or a REMIX: the card's type line is locked (owner decision
   *  2026-09-16, lib/creator/revise.ts — the supertype never leaves the
   *  client), so the entry can't add the word: on a card with no legendary
   *  face it is disabled, with that reason. */
  typeLineLocked?: boolean;
};

export type LegendaryVariation = {
  /** The entry can be picked. */
  available: boolean;
  /** Why it can't, in plain words; null while it can. */
  reason: string | null;
  /** The crown is on and drawn: the entry's pressed state. */
  selected: boolean;
  /** The anatomy panel shows its "Legendary crown" switch (a face has the
   *  word on a frame that draws the crown). */
  switchShown: boolean;
  /** The face whose supertype takes the word "Legendary" when the entry is
   *  picked; null when a face already has it (or the entry is unavailable). */
  addsWordTo: "front" | "back" | null;
};

/** The reasons the entry is disabled with — one line, plain words. */
export const NO_CROWN_REASON = "This frame has no legendary crown";
export const NO_CROWN_COLOUR_REASON = "This frame has no legendary crown in this colour";
export const NOT_LEGENDARY_LOCKED_REASON = "Only a Legendary card prints the crown, and this card\u2019s type line is fixed";

/** The supertype with "Legendary" FIRST, where the prints put it ("Legendary
 *  Artifact Creature", "Legendary Snow Land"); unchanged — its spacing
 *  normalised — when it already says the word. */
export function withLegendaryWord(supertype: string | null | undefined): string {
  const words = supertypeWords(supertype);
  return supertypeHasWord(supertype, "Legendary") ? words.join(" ") : ["Legendary", ...words].join(" ");
}

export function legendaryVariationOf(input: LegendaryVariationInput): LegendaryVariation {
  const profile = getFrameProfile(input.template ?? undefined);
  const anatomy = frameAnatomyOf(input.template);
  const frontType = input.cardType ?? null;
  // The save keeps the switch only on a template that draws the crown
  // (normalizeAnatomy reads the card's OWN template — the front body of a
  // double-faced card), so nothing is offered that the save would drop.
  if (!anatomy.crown) return unavailable(NO_CROWN_REASON);

  // The front: would it draw a crown, legendary and switched on? The ONE
  // overlay rule both renderers draw with answers (crownKeyFor): the card
  // type prints one and the key it would paint is published.
  const frontTypePrints = qualifiesForCrown({ cardType: frontType, supertype: "Legendary" });
  const frontCanDraw =
    frontTypePrints &&
    crownKeyFor(
      {
        colorIdentity: input.colorIdentity,
        cost: input.cost ?? null,
        cardType: frontType,
        supertype: withLegendaryWord(input.supertype),
        frameStyle: { crown: true, twoColor: input.twoColor === true },
      },
      profile,
    ) !== null;

  // The back of a double-faced card wears the same switch by its own
  // supertype, on the body its type and the family derive (bodyFor — the
  // form's live preview's derivation); a back body that draws none (the ▼
  // land back, the modal land pair) never counts.
  const front = dfcBodyOf(input.template ?? undefined);
  const backBody =
    front?.role === "front"
      ? bodyFor(front.layout, "back", input.backCardType || null, isDfcIconFamily(input.dfcIcon) ? input.dfcIcon : DEFAULT_DFC_ICON)
      : null;
  const backType = (input.backCardType || null) as CardType | null;
  const backCanDraw =
    backBody !== null && frameAnatomyOf(backBody).crown && qualifiesForCrown({ cardType: backType, supertype: "Legendary" });

  if (!frontCanDraw && !backCanDraw) return unavailable(frontTypePrints ? NO_CROWN_COLOUR_REASON : NO_CROWN_REASON);

  const frontHasWord = frontCanDraw && supertypeHasWord(input.supertype, "Legendary");
  const backHasWord = backCanDraw && supertypeHasWord(input.backSupertype, "Legendary");
  const drawn = frontHasWord || backHasWord;
  if (!drawn && input.typeLineLocked === true) return unavailable(NOT_LEGENDARY_LOCKED_REASON);
  return {
    available: true,
    reason: null,
    selected: input.crown === true && drawn,
    switchShown: drawn,
    addsWordTo: drawn ? null : frontCanDraw ? "front" : "back",
  };
}

function unavailable(reason: string): LegendaryVariation {
  return { available: false, reason, selected: false, switchShown: false, addsWordTo: null };
}
