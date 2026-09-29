import "server-only";

import { getCardById, pickPrintImageUrl } from "@/lib/scryfall/client";
import {
  mapScryfallToFormPatch,
  referenceColorIdentity,
  type ScryfallImportPatch,
} from "@/lib/scryfall/import-mapper";
import { previewFromImportPatch } from "@/lib/scryfall/preview-from-patch";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Builds the frame-compare tool's "our render" input from a real Scryfall
// printing at request time — no hand-transcription per reference. The
// import mapper already knows how to translate Scryfall fields (multi-face
// cards, type-line parsing, rarity mapping); previewFromImportPatch reshapes
// its form patch into CardPreviewData (front AND back face) and pins the
// frame template under test.
//
// The same form patch seeds the admin's walk through the stepper (TODO 2.2,
// lib/creator/frame-walkthrough.ts), so the creator is prefilled with
// exactly the content the compare view renders and scores.
// ---------------------------------------------------------------------------

export type FrameComparePayload = {
  preview: CardPreviewData;
  /** 745×1040 PNG of the real printing, for the overlay. */
  scanUrl: string | null;
  cardName: string;
  /** The import mapper's form patch the preview was built from (the second
   *  face included) — the walk-through's seed. */
  patch: ScryfallImportPatch;
  /** The printing's Scryfall page, for the creator's "Based on" chip. */
  scryfallUri: string | null;
};

export async function buildFrameComparePayload(
  scryfallId: string,
  template: FrameTemplate,
): Promise<FrameComparePayload | null> {
  const card = await getCardById(scryfallId);
  if (!card) return null;

  const patch = mapScryfallToFormPatch(card, { artPreviewUrl: null });

  return {
    preview: {
      ...previewFromImportPatch(patch, card.name, template),
      // Two colours stay two here, so a split frame draws the scan's split.
      colorIdentity: referenceColorIdentity(card),
    },
    scanUrl: pickPrintImageUrl(card),
    cardName: card.name,
    patch,
    scryfallUri: card.scryfall_uri ?? null,
  };
}
