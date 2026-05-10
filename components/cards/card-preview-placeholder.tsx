// Thin wrapper around the canonical CardPreview that fills sensible default
// values for marketing surfaces (landing hero, gallery teasers) where there's
// no real card data yet.

import type { CardPreview as CardPreviewType } from "@/types";
import {
  CardPreview,
  type CardPreviewData,
} from "@/components/cards/card-preview";

type CardPreviewPlaceholderProps = {
  card?: Partial<CardPreviewType>;
  className?: string;
};

export function CardPreviewPlaceholder({
  card,
  className,
}: CardPreviewPlaceholderProps) {
  const data: CardPreviewData = {
    title: card?.title ?? "Untitled Card",
    cost: card?.cost ?? "{2}{X}",
    cardType: card?.cardType ?? "creature",
    rarity: card?.rarity ?? "rare",
    colorIdentity: card?.colorIdentity ? [card.colorIdentity] : ["multicolor"],
    artistCredit: card?.artistCredit ?? "Unknown Artist",
    rulesText:
      "Generic rules text appears here. Stable structured fields render via the live preview as the creator builds out the card.",
  };

  return <CardPreview {...data} className={className} />;
}
