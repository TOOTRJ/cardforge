// ---------------------------------------------------------------------------
// What a change of card type would throw away (TODO 5.14, quick fix 1).
//
// Leaving a kind that has a second part (a transform or modal card's back
// face, a split / aftermath / flip half, an adventure's spell) for a kind
// that has none empties `back_face` — its name, cost, rules, stats and
// artwork. The creator used to do it without a word. These helpers say
// WHETHER anything the maker wrote would go (nothing = nothing to ask) and
// name it for the confirm dialog. Pure: no React, no form state.
// ---------------------------------------------------------------------------

import { isBlankBackFace } from "@/lib/creator/card-fields";
import type { BackFaceFormValues } from "@/lib/creator/form-types";
import { listPhrase } from "@/lib/creator/save-needs";
import type { SecondPartWords } from "@/lib/creator/second-part";

const filled = (value: string | null | undefined) => Boolean(value?.trim());

/** The things a second part holds, in the order a card prints them. Covers
 *  exactly the fields isBlankBackFace judges — the two cannot disagree
 *  about an empty face (a test holds them together). */
export function secondPartContents(face: BackFaceFormValues): string[] {
  return [
    filled(face.title) ? "name" : null,
    filled(face.cost) ? "cost" : null,
    filled(face.supertype) || filled(face.subtypes_text) ? "type line" : null,
    filled(face.rules_text) ? "rules text" : null,
    filled(face.flavor_text) ? "flavor text" : null,
    filled(face.power) || filled(face.toughness) || filled(face.loyalty) || filled(face.defense) ? "stats" : null,
    filled(face.artist_credit) ? "artist credit" : null,
    filled(face.art_url) ? "artwork" : null,
  ].filter((part): part is string => part !== null);
}

export type SecondPartLoss = {
  /** The dialog's heading: "Remove the back face?". */
  title: string;
  /** What goes: "Changing this card to Creature removes the back face
   *  (“Insectile Aberration”) — its name, rules text and artwork." */
  message: string;
  /** The way back, offered because the form keeps the part for the session. */
  restoreNote: string;
  /** The confirm button: "Remove the back face". */
  confirmLabel: string;
};

/** The loss a kind change would cause, or null when the second part holds
 *  nothing the maker wrote. */
export function describeSecondPartLoss(input: {
  face: BackFaceFormValues;
  words: SecondPartWords;
  /** The kind being left ("Transform") and the one picked ("Creature"). */
  fromLabel: string;
  toLabel: string;
}): SecondPartLoss | null {
  if (isBlankBackFace(input.face)) return null;
  const contents = secondPartContents(input.face);
  const name = input.face.title.trim();
  return {
    title: `Remove ${input.words.phrase}?`,
    message: `Changing this card to ${input.toLabel} removes ${input.words.phrase}${name ? ` (“${name}”)` : ""} — its ${listPhrase(contents)}.`,
    restoreNote: `If you switch back to ${input.fromLabel} before you leave this page, it comes back as it was. It is never saved with a ${input.toLabel} card.`,
    confirmLabel: `Remove ${input.words.phrase}`,
  };
}
