// ---------------------------------------------------------------------------
// The words for a card's two parts (TODO 5.14, quick fixes of 2026-10-12).
//
// A transform or modal card has a front and a BACK FACE; a split card a left
// and a RIGHT HALF; an aftermath card a top and an AFTERMATH HALF; an
// adventure a creature and an ADVENTURE SPELL; a flip card a top and a
// FLIPPED SIDE. The creator used to call every one of them "second face" or
// "back face" and to lend one kind's example text to another (a transform
// back's name suggested on a split half).
//
// This is the ONE table: every label, placeholder, accessible name and
// sentence about a second part reads it, and the Face tabs (5.14's main
// change) take their switch labels — `first` | `second` — from it too.
// Pure: no React, no form state.
// ---------------------------------------------------------------------------

import { kindFromCard, type CardKind } from "@/lib/creator/card-kinds";
import type { CardType } from "@/types/card";

export type SecondPartWords = {
  /** The first part's label, as a switch would show it ("Left half"). */
  first: string;
  /** The second part's label ("Right half"). Sentence case. */
  second: string;
  /** The second part inside a sentence, with its article ("the right
   *  half"). */
  phrase: string;
  /** The two parts together inside a sentence ("both halves") — what the
   *  line under the Face tabs switch calls them. */
  both: string;
  /** Example name for the second part's name field — a real card of THIS
   *  kind, never another kind's. */
  namePlaceholder: string;
  /** Example rules for the second part's rules box. */
  rulesPlaceholder: string;
  /** The card type a NEW card's untouched second part starts with, when it
   *  is not the kind's own (an adventure's spell is an instant, never the
   *  creature it rides on). Null = the kind's own card type. */
  blankCardType: CardType | null;
  /** False while the creator has no editor for this second part: a switch
   *  shows it greyed out with `unavailableNote`. Every kind's is available
   *  since TODO 5.5 — a battle whose back can't be edited as a face (one
   *  saved with none, or a legacy back; lib/creator/battle-back.ts) gets
   *  these words with `available: false` and its own note. */
  available: boolean;
  unavailableNote: string | null;
};

const lower = (label: string) => `${label.charAt(0).toLowerCase()}${label.slice(1)}`;

function words(
  first: string,
  second: string,
  rest: Pick<SecondPartWords, "namePlaceholder" | "rulesPlaceholder"> &
    Partial<Pick<SecondPartWords, "both" | "blankCardType" | "available" | "unavailableNote">>,
): SecondPartWords {
  return {
    first,
    second,
    phrase: `the ${lower(second)}`,
    both: "both faces",
    blankCardType: null,
    available: true,
    unavailableNote: null,
    ...rest,
  };
}

/** Every kind whose card has a second part. */
export const SECOND_PART_WORDS: Readonly<Partial<Record<CardKind, SecondPartWords>>> = {
  transform: words("Front face", "Back face", {
    namePlaceholder: "Insectile Aberration",
    rulesPlaceholder: "Flying. Whenever the back face deals damage…",
  }),
  mdfc: words("Front face", "Back face", {
    namePlaceholder: "Emeria, Shattered Skyclave",
    rulesPlaceholder: "{T}: Add {W}. (The other mode's rules.)",
  }),
  adventure: words("Creature", "Adventure spell", {
    namePlaceholder: "Stomp",
    rulesPlaceholder: "Stomp deals 2 damage to any target. (The adventure's rules.)",
    both: "both parts",
    blankCardType: "instant",
  }),
  // The Prepare card (TODO 4.27): the creature, and the spell on the page
  // to its right (SOS #109 Blazing Firesinger's Seething Song) — most are
  // sorceries.
  prepare: words("Creature", "Prepare spell", {
    namePlaceholder: "Seething Song",
    rulesPlaceholder: "Add {R}{R}{R}{R}{R}. (The spell's rules.)",
    both: "both parts",
    blankCardType: "sorcery",
  }),
  split: words("Left half", "Right half", {
    namePlaceholder: "Ice",
    rulesPlaceholder: "Tap target permanent. Draw a card. (The right half's rules.)",
    both: "both halves",
  }),
  aftermath: words("Top half", "Aftermath half", {
    namePlaceholder: "Ribbons",
    rulesPlaceholder: "Aftermath (Cast this spell only from your graveyard. Then exile it.)",
    both: "both halves",
  }),
  flip: words("Top side", "Flipped side", {
    namePlaceholder: "Tok-Tok, Volcano Born",
    rulesPlaceholder: "Protection from red. (The rules once the card is flipped.)",
    both: "both sides",
  }),
  // A battle's back (TODO 5.5): the portrait ▼ back, a creature to start
  // (MOM #21's Serra Faithkeeper — most battle backs are).
  battle: words("Battle", "Back face", {
    namePlaceholder: "Serra Faithkeeper",
    rulesPlaceholder: "Flying, vigilance. (The back face's rules.)",
    blankCardType: "creature",
  }),
  // A double-faced saga's back (TODO 5.5 (b)): a saga on its transform
  // front (`sagadfcfront`) — Kamigawa: Neon Dynasty's enchantment creatures
  // (NEO #141's Reflection of Kiki-Jiki). A one-faced saga has no switch.
  saga: words("Saga", "Back face", {
    namePlaceholder: "Reflection of Kiki-Jiki",
    rulesPlaceholder: "Haste. (The back face's rules.)",
    blankCardType: "creature",
  }),
  // A double-sided token's back (TODO 5.5 (c), owner Round 76): another
  // token (Guild Kit #4's Soldier behind its Goblin). A one-faced token has
  // no switch: the form shows these words only while "Two faces" is on.
  token: words("Front face", "Back face", {
    namePlaceholder: "Soldier",
    rulesPlaceholder: "Lifelink. (The back face's rules.)",
    blankCardType: "token",
  }),
};

/** A double-faced back kept from before the real frames (an imported
 *  transform / modal card on a standard frame): still a back face. */
export const LEGACY_SECOND_PART_WORDS: SecondPartWords = words("Front face", "Back face", {
  namePlaceholder: "",
  rulesPlaceholder: "",
});

/** The words for `kind`'s second part, or null for a one-part kind. */
export function secondPartWordsFor(kind: CardKind): SecondPartWords | null {
  return SECOND_PART_WORDS[kind] ?? null;
}

/** The words for the second part a FORM holds: the kind's own, else — for
 *  a card that has a back face on a one-part kind's frame (a legacy
 *  double-faced back) — "Back face". */
export function secondPartWordsOfCard(
  cardType: CardType | "" | null | undefined,
  template: string | null | undefined,
): SecondPartWords {
  const own = secondPartWordsFor(kindFromCard(cardType, template));
  return own && own.available ? own : LEGACY_SECOND_PART_WORDS;
}

/** "Right half" → "Right half name" style field names. */
export function secondPartFieldName(partWords: SecondPartWords, field: string): string {
  return `${partWords.second} ${field}`;
}
