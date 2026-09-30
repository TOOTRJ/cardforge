// The mechanics an AI deck remix copies from a REAL printing (TODO 1.22) —
// pure, so the remix step's frame choice is the tested path
// (tests/unit/ai/remix-mechanics.test.ts). executeDeckRemixStep
// (lib/ai/generation-jobs.ts) maps the printing through the creator's import
// mapper and hands the result to createCardAction with a new name, flavour
// and art — on a two-part layout card, a new name for each half
// (lib/ai/remix-names.ts, owner decision B3 2026-09-29).
//
// The frame is resolved like the creator import (remixFrameFor): the
// printing's own frame when it is published in the card's colour, else its
// card type's standard, and a layout kind lands on its layout template with
// the printed card type. It used to pass `patch.frame_template` straight to
// the save, so an old-border printing failed the frame gate (Juggernaut LEA
// → agclassic/c, Seat of the Synod MRD → modernland/u, Command Tower C13 →
// modernland/m) and a layout kind — which has no frame_template — saved on
// the default M15 frame.

import type { ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import { backFaceFromPatch, splitSubtypes } from "@/lib/scryfall/preview-from-patch";
import { remixFrameFor } from "@/lib/creator/frame-resolve";
import { templatePaintsSecondFace } from "@/lib/creator/card-kinds";
import type { CardBackFace, CardType, ColorIdentity, FrameTemplate } from "@/types/card";
import { importedAnatomy, type FrameAnatomyStyle } from "@/lib/cards/anatomy";

export type ScryfallRemixMechanics = {
  title: string;
  cost?: string;
  card_type?: CardType;
  supertype?: string;
  subtypes: string[];
  rarity?: string;
  color_identity?: ColorIdentity[];
  rules_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  source_scryfall_id?: string;
  frame_template: FrameTemplate;
  /** The printing's own anatomy switches (the crown, the two-colour frame —
   *  lib/cards/anatomy.ts importedAnatomy), saved with the frame: the remix
   *  follows its printing, and only where the printing says something (owner
   *  round 17: printing-only) — createCardAction stamps the new-card default
   *  for the rest, as the creator's form holds it (importedFormAnatomy), and
   *  keeps only what the frame draws. */
  anatomy: FrameAnatomyStyle;
  /** The second half a layout frame paints (the adventure's storybook
   *  page, the split / aftermath / flip half) — set only when the landed
   *  template paints one, so a card that fell back to a standard frame
   *  never becomes a double-faced card. */
  back_face?: CardBackFace;
};

/**
 * The remix mechanics of a mapped Scryfall printing, or the step error when
 * no frame is published for the card's colour. `fallbackTitle` is the deck
 * entry's name, for a printing the mapper couldn't title.
 */
export function scryfallRemixMechanics(
  patch: ScryfallImportPatch,
  fallbackTitle: string,
  verifiedKeys: ReadonlySet<string>,
): { ok: true; mechanics: ScryfallRemixMechanics } | { ok: false; error: string } {
  const frame = remixFrameFor(patch, verifiedKeys);
  if (!frame.ok) return frame;

  const back = templatePaintsSecondFace(frame.template)
    ? backFaceFromPatch(patch.back_face)
    : null;
  // The printing's pair where the landed frame draws the two-colour frame.
  const anatomy = importedAnatomy(patch, frame.template);

  return {
    ok: true,
    mechanics: {
      title: patch.title ?? fallbackTitle,
      cost: patch.cost,
      card_type: frame.card_type,
      supertype: patch.supertype,
      subtypes: splitSubtypes(patch.subtypes_text),
      rarity: patch.rarity,
      color_identity: anatomy.colorIdentity,
      rules_text: patch.rules_text,
      flavor_text: patch.flavor_text,
      power: patch.power,
      toughness: patch.toughness,
      loyalty: patch.loyalty,
      defense: patch.defense,
      source_scryfall_id: patch.source_scryfall_id,
      frame_template: frame.template,
      anatomy: anatomy.style,
      // The half keeps the printing's rules, never its artist: the remix's
      // art is new (the front's credit is the remixer's). Its name and
      // flavour are the AI identity's (applyRemixNames, B3).
      back_face: back ? { ...back, artist_credit: undefined, art_url: undefined } : undefined,
    },
  };
}
