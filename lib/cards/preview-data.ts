import type { ArtPosition, Card, FrameStyle } from "@/types/card";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { FrameProfileOverridesMap } from "@/lib/cards/profile-override";
import { drawableCardMedia } from "@/lib/cards/drawable-media";

// Map a persisted Card row to the flat props <CardPreview> consumes. Used
// wherever a whole card needs to render — notably the v2 back face, where a
// referenced card is drawn on the flip with its OWN frame/colour/rarity/art.
export function cardToPreviewData(
  card: Card,
  profileOverrides: FrameProfileOverridesMap | null = null,
): CardPreviewData {
  // Only the pictures CardPreview would draw (lib/cards/drawable-media.ts).
  return drawableCardMedia({
    profileOverrides,
    title: card.title,
    cost: card.cost,
    cardType: card.card_type,
    supertype: card.supertype,
    ...(typeof card.printed_types === "string" ? { printedTypes: card.printed_types } : {}),
    subtypes: card.subtypes,
    rarity: card.rarity,
    colorIdentity: card.color_identity,
    rulesText: card.rules_text,
    flavorText: card.flavor_text,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    defense: card.defense,
    artistCredit: card.artist_credit,
    artUrl: card.art_url,
    artPosition: (card.art_position as ArtPosition) ?? {},
    frameStyle: (card.frame_style as FrameStyle) ?? {},
    setIconUrl: card.set_icon_url,
    setIconCode: card.set_icon_code,
    faceContent: card.face_content ?? null,
    watermark: card.watermark ?? null,
    // The collector fields (migration 0133, TODO 4.9a) — carried, not drawn
    // (4.9b). `Card` requires the three columns, so a caller whose select
    // lacks them fails typecheck rather than silently handing over nothing;
    // rowToPreviewData (lib/cards/bake-core.ts) maps the same three.
    setCode: card.set_code,
    collectorNumber: card.collector_number,
    lang: card.lang,
  });
}
