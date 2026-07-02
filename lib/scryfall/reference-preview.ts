import "server-only";

import { getCardById, pickPrintImageUrl } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Builds the frame-compare tool's "our render" input from a real Scryfall
// printing at request time — no hand-transcription per reference. The
// import mapper already knows how to translate Scryfall fields (multi-face
// cards, type-line parsing, rarity mapping); this just reshapes its form
// patch into CardPreviewData and pins the frame template under test.
// ---------------------------------------------------------------------------

export type FrameComparePayload = {
  preview: CardPreviewData;
  /** 745×1040 PNG of the real printing, for the overlay. */
  scanUrl: string | null;
  cardName: string;
};

export async function buildFrameComparePayload(
  scryfallId: string,
  template: FrameTemplate,
): Promise<FrameComparePayload | null> {
  const card = await getCardById(scryfallId);
  if (!card) return null;

  const patch = mapScryfallToFormPatch(card, { artPreviewUrl: null });

  const preview: CardPreviewData = {
    title: patch.title ?? card.name,
    cost: patch.cost ?? null,
    cardType: patch.card_type ?? null,
    supertype: patch.supertype ?? null,
    subtypes: patch.subtypes_text
      ? patch.subtypes_text.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    rarity: patch.rarity ?? null,
    colorIdentity: patch.color_identity ?? [],
    rulesText: patch.rules_text ?? null,
    flavorText: patch.flavor_text ?? null,
    power: patch.power ?? null,
    toughness: patch.toughness ?? null,
    loyalty: patch.loyalty ?? null,
    defense: patch.defense ?? null,
    artistCredit: patch.artist_credit ?? null,
    // Frame geometry is the comparison target; the scan supplies the art
    // visually, and we don't rehost WotC art for a dev utility.
    artUrl: null,
    frameStyle: { template },
  };

  return {
    preview,
    scanUrl: pickPrintImageUrl(card),
    cardName: card.name,
  };
}
