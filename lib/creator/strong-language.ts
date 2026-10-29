// ---------------------------------------------------------------------------
// The creator's side of the strong-language rule (owner policy 2026-10-28,
// lib/moderation/profanity.ts): the fields of the form that would make a
// save at `visibility` PRIVATE, read through the ONE detector and the ONE
// rule the card actions apply — so the Publish step's note, its unavailable
// chips and the visibility the save sends say what the server will do.
// Pure.
// ---------------------------------------------------------------------------

import { languageForcesPrivate, type ProfanityField } from "@/lib/moderation/profanity";
import type { FormValues } from "@/lib/creator/form-types";
import type { Card, Visibility } from "@/types/card";

export type CreatorLanguageContext = {
  /** The stored row an EDIT opened (null for a new card and a remix): an
   *  edit that adds no strong language to a card already in view, and asks
   *  for no wider audience, is left as it is. */
  stored: Pick<Card, "visibility"> & Partial<Card> | null;
  /** Whether the save stores the footer field as typed (a subscriber's new
   *  card, an edit whose footer changed) — the field otherwise shows the
   *  profile default and is not what the row will hold. */
  footerStored: boolean;
};

/** The form's text, as the detector reads it (the second face only while
 *  the card has one). */
function scanOf(values: FormValues, footerStored: boolean) {
  return {
    title: values.title,
    nickname: values.nickname,
    supertype: values.supertype,
    printed_types: values.printed_types,
    subtypes_text: values.subtypes_text,
    rules_text: values.rules_text,
    loyalty_abilities: values.loyalty_abilities,
    saga_intro: values.saga_intro,
    saga_chapters: values.saga_chapters,
    flavor_text: values.flavor_text,
    artist_credit: values.artist_credit,
    // The printed stats and the collector line.
    cost: values.cost,
    power: values.power,
    toughness: values.toughness,
    loyalty: values.loyalty,
    defense: values.defense,
    set_code: values.set_code,
    collector_number: values.collector_number,
    tags_text: values.tags_text,
    footer_text: footerStored ? values.footer_text : undefined,
    back_face: values.has_back_face ? values.back_face : null,
  };
}

/** The fields that make a save of `values` at `visibility` private — empty
 *  when it saves as asked. */
export function creatorLanguageFields(
  values: FormValues,
  visibility: Visibility,
  context: CreatorLanguageContext,
): ProfanityField[] {
  return languageForcesPrivate({
    saved: scanOf(values, context.footerStored),
    visibility,
    stored: context.stored ? { card: context.stored, visibility: context.stored.visibility } : null,
  });
}

/** Which of the Publish step's two choices the text rules out, and the
 *  fields that do it (empty = both are open). */
export type StrongLanguageChoices = {
  public: ProfanityField[];
  unlisted: ProfanityField[];
};

export function strongLanguageChoices(values: FormValues, context: CreatorLanguageContext): StrongLanguageChoices {
  return {
    public: creatorLanguageFields(values, "public", context),
    unlisted: creatorLanguageFields(values, "unlisted", context),
  };
}
