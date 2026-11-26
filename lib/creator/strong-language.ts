// ---------------------------------------------------------------------------
// The creator's side of the strong-language rule (owner policy 2026-10-28,
// lib/moderation/profanity.ts): the fields of the form that would make a
// save at `visibility` PRIVATE, read through the ONE detector and the ONE
// rule the card actions apply — so the Publish step's note, its unavailable
// chips and the visibility the save sends say what the server will do.
// Pure.
// ---------------------------------------------------------------------------

import {
  languageForcesPrivate,
  languageForcesPrivateByVisibility,
  type ProfanityField,
} from "@/lib/moderation/profanity";
import { kindFromCard } from "@/lib/creator/card-kinds";
import type { FormValues } from "@/lib/creator/form-types";
import { submittedRulesOf, type SubmittedRulesOptions } from "@/lib/creator/structured-rules";
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
  /** How the save writes the rules text and the rows: `submittedRulesOf`'s
   *  options as the form's save passes them (an edit's opened values and
   *  stored rows, the station and saga creature frames). Absent: a new
   *  card's. */
  rules?: SubmittedRulesOptions;
};

/** The form's text as the save WRITES it, as the detector reads it (the
 *  second face only while the card has one). The rules are what the save
 *  sends (submittedRulesOf: a walker's or a saga's rows serialized into the
 *  rules text and `face_content`, the saga creature's "Creature abilities"
 *  after the chapters) — the text the server judges. Never the form's
 *  `rules_text` beside the rows: for a walker or a saga it is a hidden copy
 *  the row editors never update (an edit's stored text, the text before a
 *  kind switch), so a word taken out of a row stayed in it, and the saga
 *  creature's box was read nowhere. */
function scanOf(values: FormValues, context: CreatorLanguageContext) {
  const rules = submittedRulesOf(kindFromCard(values.card_type, values.frame_style?.template), values, context.rules ?? {});
  return {
    title: values.title,
    nickname: values.nickname,
    supertype: values.supertype,
    printed_types: values.printed_types,
    subtypes_text: values.subtypes_text,
    rules_text: rules.rulesText,
    face_content: rules.faceContent,
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
    footer_text: context.footerStored ? values.footer_text : undefined,
    back_face: values.has_back_face ? values.back_face : null,
  };
}

const storedOf = (context: CreatorLanguageContext) =>
  context.stored ? { card: context.stored, visibility: context.stored.visibility } : null;

/** The fields that make a save of `values` at `visibility` private — empty
 *  when it saves as asked. */
export function creatorLanguageFields(
  values: FormValues,
  visibility: Visibility,
  context: CreatorLanguageContext,
): ProfanityField[] {
  return languageForcesPrivate({ saved: scanOf(values, context), visibility, stored: storedOf(context) });
}

/** Which of the Publish step's two choices the text rules out, and the
 *  fields that do it (empty = both are open). */
export type StrongLanguageChoices = {
  public: ProfanityField[];
  unlisted: ProfanityField[];
};

/** Both choices from ONE read of the form's text — what
 *  `creatorLanguageFields` says for "public" and for "unlisted". */
export function strongLanguageChoices(values: FormValues, context: CreatorLanguageContext): StrongLanguageChoices {
  return languageForcesPrivateByVisibility({ saved: scanOf(values, context), stored: storedOf(context) });
}

const NOTHING_RULED_OUT: ProfanityField[] = [];
Object.freeze(NOTHING_RULED_OUT);

/** What the Publish step is handed while it is not on screen: nothing ruled
 *  out. One frozen value, so a render that skips the check hands the same
 *  object every time. The form computes the real choices only on the
 *  Publish step (its one reader); the save runs its own check. */
export const NO_STRONG_LANGUAGE: StrongLanguageChoices = Object.freeze({
  public: NOTHING_RULED_OUT,
  unlisted: NOTHING_RULED_OUT,
});
